// Mode Claude : Claude voit l'écran du téléphone (capture + arbre UI) et
// choisit l'action suivante avec des outils. Les actions sensibles passent par
// le bot : like_post respecte les limites et vérifie le like, prepare_dm tape
// le message sans jamais l'envoyer. Taper soi-même sur J'aime, Envoyer, Suivre
// ou Publier est refusé.

import Anthropic from '@anthropic-ai/sdk';
import { parseUiXml, compactTree, nodeAt, clickableAncestor, matches, label, center, nearest, findAll } from './uitree.js';
import { SEL } from './selectors.js';
import { sleep, throwIfStopped, StoppedError, jitterPoint } from './control.js';
import { likeState } from './bot.js';

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recommandé)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (rapide)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (économique)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (le plus puissant)' },
];
// Modèles qui acceptent le repli serveur si les classifieurs déclinent une requête.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);

const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS = [
  { name: 'tap_element', description: 'Touche un élément de l’arbre UI par son numéro [n]. Méthode à préférer.', input_schema: obj({ element: { type: 'integer', description: 'Numéro [n] de l’élément dans l’arbre UI.' } }) },
  { name: 'tap_point', description: 'Touche un point de la capture d’écran (coordonnées en pixels de la capture). À utiliser seulement si l’élément n’est pas dans l’arbre.', input_schema: obj({ x: { type: 'number' }, y: { type: 'number' } }) },
  { name: 'swipe', description: 'Fait défiler l’écran. "up" = faire défiler vers le contenu suivant (le doigt monte).', input_schema: obj({ direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] } }) },
  { name: 'type_text', description: 'Tape du texte dans le champ qui a le focus (touche-le d’abord). Pour un DM, utilise prepare_dm.', input_schema: obj({ text: { type: 'string' } }) },
  { name: 'press_back', description: 'Touche Retour d’Android.', input_schema: obj({}) },
  { name: 'open_profile', description: 'Ouvre directement le profil Instagram d’un compte.', input_schema: obj({ username: { type: 'string', description: 'Nom du compte, sans @.' } }) },
  { name: 'open_hashtag', description: 'Ouvre directement la page d’un hashtag.', input_schema: obj({ tag: { type: 'string', description: 'Hashtag, sans #.' } }) },
  { name: 'like_post', description: 'Like la publication dont le bouton J’aime porte ce numéro [n]. Respecte les limites prudentes (peut attendre le délai entre deux likes) et vérifie à l’écran que le like est bien enregistré. Seul moyen autorisé de liker.', input_schema: obj({ element: { type: 'integer', description: 'Numéro [n] du bouton J’aime.' } }) },
  { name: 'read_profile', description: 'Lit les infos du profil affiché (nom, bio, lien, compteurs).', input_schema: obj({}) },
  { name: 'prepare_dm', description: 'Ouvre la conversation avec un compte et tape le message SANS l’envoyer. L’utilisateur relit et envoie lui-même depuis l’app.', input_schema: obj({ username: { type: 'string' }, message: { type: 'string' } }) },
  { name: 'wait', description: 'Attend que l’écran se charge (1 à 10 secondes).', input_schema: obj({ seconds: { type: 'integer', minimum: 1, maximum: 10 } }) },
  { name: 'finish', description: 'Termine la mission avec un court bilan pour l’utilisateur.', input_schema: obj({ summary: { type: 'string' } }) },
].map((t) => ({ ...t, strict: true }));

const SYSTEM = `Tu pilotes l’app Instagram d’un vrai téléphone Android, branché en USB à un PC Windows, pour le compte de son propriétaire.

À chaque étape tu reçois une capture d’écran et l’arbre UI compact. Chaque ligne de l’arbre a la forme : [n] Classe texte="…" desc="…" id=… (x1,y1,x2,y2) drapeaux. Les coordonnées sont en pixels de la capture.

Comment agir :
- Préfère tap_element avec le numéro [n] ; tap_point seulement si l’élément manque dans l’arbre.
- Pour aller sur un compte ou un hashtag, utilise open_profile ou open_hashtag plutôt que la recherche.
- Après chaque action, regarde la nouvelle capture pour vérifier ce qui s’est passé avant de continuer.
- Si l’écran n’a pas changé, attends (wait) ou essaie autre chose. Ne répète pas trois fois la même action.

Règles du propriétaire, non négociables :
- Pour liker, uniquement like_post. Ce bouton applique des limites prudentes (plafond par jour et par heure, délais aléatoires) et ne compte un like que s’il est vérifié à l’écran. Si like_post répond qu’une limite est atteinte ou qu’une pause est en cours, arrête-toi avec finish.
- Les messages privés : uniquement prepare_dm, qui tape le message sans l’envoyer. Tu ne touches jamais au bouton Envoyer ; c’est l’utilisateur qui confirme l’envoi dans l’app.
- Pas d’abonnement, pas de commentaire publié, pas de modification du compte ou de ses réglages, pas d’achat.
- Si Instagram affiche « Réessayez plus tard », une vérification de compte ou toute alerte de sécurité, arrête-toi aussitôt avec finish et décris ce que tu vois.
- Les messages rédigés pour le propriétaire doivent être sincères et personnalisés, jamais trompeurs.

Quand la mission est remplie, ou impossible, appelle finish avec un bilan court en français.`;

export class AiError extends Error {}

export class Agent {
  /**
   * @param {object} ctx
   * @param {import('./bot.js').Bot} ctx.bot
   * @param {() => any} ctx.getDevice
   * @param {() => object} ctx.settings réglages IA courants
   * @param {(png:Buffer) => Promise<{data:Buffer, mediaType:string, width:number}>} ctx.prepareImage
   * @param {(level:string, msg:string, data?:object) => void} ctx.log
   * @param {(e:object) => void} ctx.event
   * @param {() => AbortSignal} ctx.signal
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.running = false;
  }

  get signal() {
    return this.ctx.signal();
  }

  async observe() {
    const device = this.ctx.getDevice();
    const png = await device.screencap({ signal: this.signal });
    const size = await device.screenSize();
    let nodes = [];
    let unreadable = false;
    try {
      nodes = parseUiXml(await device.dumpUi({ signal: this.signal }));
    } catch (e) {
      if (e.name !== 'UnreadableScreenError') throw e;
      unreadable = true;
    }
    const img = await this.ctx.prepareImage(png);
    const scale = img.width / size.width;
    this.last = { nodes, scale, size };
    const tree = unreadable
      ? '(arbre illisible : une animation tourne en continu à l’écran. Seule la capture est disponible ; aucun élément n’est numéroté. Fais défiler vers la publication suivante ou reviens en arrière.)'
      : compactTree(nodes, scale);
    return { image: img, tree, scale, nodes };
  }

  observationText(obs) {
    return `Capture : ${Math.round(obs.scale * this.last.size.width)} × ${Math.round(obs.scale * this.last.size.height)} px.\nArbre UI :\n${obs.tree}`;
  }

  /** Refuse les taps sur les boutons réservés. */
  guardTap(node) {
    if (!node) return null;
    const all = this.last.nodes;
    const target = clickableAncestor(all, node);
    const hit = (sels) => [node, target].some((n) => (Array.isArray(sels) ? sels : [sels]).some((s) => matches(n, s)));
    if (hit(SEL.likeButton)) return 'Refusé : pour liker, utilise like_post (limites et vérification).';
    if (hit(SEL.dmSend)) return 'Refusé : l’envoi des messages est réservé à l’utilisateur. Le message préparé attend sa confirmation dans l’app.';
    if (hit(SEL.followButton)) return 'Refusé : les abonnements ne sont pas autorisés en mode agent.';
    if (hit(SEL.commentPost)) return 'Refusé : publier un commentaire n’est pas autorisé en mode agent.';
    return null;
  }

  async exec(name, input) {
    const { bot } = this.ctx;
    const device = this.ctx.getDevice();
    const sig = { signal: this.signal };
    const nodeById = (i) => this.last.nodes[Number(i)] || null;
    const toDevice = (v) => v / this.last.scale;
    switch (name) {
      case 'tap_element': {
        const n = nodeById(input.element);
        if (!n) return { error: `L’élément [${input.element}] n’existe pas sur l’écran actuel.` };
        const refused = this.guardTap(n);
        if (refused) return { error: refused };
        const [x, y] = jitterPoint([(n.bounds[0] + n.bounds[2]) / 2, (n.bounds[1] + n.bounds[3]) / 2], n.bounds, 0.12);
        await device.tap(x, y, sig);
        return { text: `Tap sur [${n.idx}] ${label(n) || n.cls.split('.').pop()}.` };
      }
      case 'tap_point': {
        const x = toDevice(Number(input.x));
        const y = toDevice(Number(input.y));
        if (!(x >= 0 && y >= 0 && x <= this.last.size.width && y <= this.last.size.height)) return { error: 'Point hors de l’écran.' };
        const refused = this.guardTap(nodeAt(this.last.nodes, x, y));
        if (refused) return { error: refused };
        await device.tap(x, y, sig);
        return { text: `Tap au point (${Math.round(input.x)}, ${Math.round(input.y)}).` };
      }
      case 'swipe': {
        const { width: w, height: h } = this.last.size;
        const m = { up: [w / 2, h * 0.75, w / 2, h * 0.3], down: [w / 2, h * 0.3, w / 2, h * 0.75], left: [w * 0.85, h / 2, w * 0.15, h / 2], right: [w * 0.15, h / 2, w * 0.85, h / 2] }[input.direction];
        if (!m) return { error: 'Direction inconnue.' };
        await device.swipe(...m, 500, sig);
        return { text: `Défilement ${input.direction}.` };
      }
      case 'type_text': {
        const focused = this.last.nodes.find((n) => n.focused && /EditText/.test(n.cls));
        if (focused && matches(focused, SEL.dmComposer[0])) return { error: 'Pour un message privé, utilise prepare_dm.' };
        const r = await device.typeText(String(input.text || ''), { ...sig, adbKeyboard: this.ctx.adbKeyboard?.() });
        return { text: `Texte tapé${r.exact ? '' : ' (accents retirés)'} : « ${r.typed} ».` };
      }
      case 'press_back':
        await device.key(4, sig);
        return { text: 'Retour.' };
      case 'open_profile':
        await bot.openProfile(input.username);
        return { text: `Profil @${input.username} ouvert.` };
      case 'open_hashtag':
        await bot.openHashtag(input.tag);
        return { text: `Hashtag #${input.tag} ouvert.` };
      case 'like_post': {
        // Le numéro vient de l'écran que Claude a vu ; on relit ensuite l'écran réel.
        let n = this.last.nodes[Number(input.element)];
        let s;
        if (!n || !SEL.likeButton.some((sel) => matches(n, sel))) return { error: `[${input.element}] n’est pas un bouton J’aime.` };
        if (likeState(n) === true) return { text: 'Cette publication est déjà likée : rien à faire.' };
        const can = this.ctx.guard.canLike();
        if (!can.ok) return { error: `Limite : ${can.reason} Arrête-toi avec finish.` };
        this.delay ??= this.ctx.guard.nextDelayMs();
        const pos = center(n);
        await bot.waitLikeDelay(this.delay.ms);
        s = await bot.screen();
        const again = nearest(findAll(s.nodes, SEL.likeButton), pos);
        n = again && again.distance < 220 ? again.node : null;
        if (!n) return { error: 'L’écran a changé pendant le délai : relis-le et rappelle like_post.' };
        const r = await bot.likeButton(s, n, { source: 'claude' });
        if (r.ok) {
          this.delay = this.ctx.guard.nextDelayMs();
          const st = this.ctx.guard.status();
          return { text: `Like vérifié sur la publication de @${r.author || '?'} (${st.today}/${st.daily} aujourd’hui).` };
        }
        if (r.skipped) return { text: `Ignoré : ${r.skipped}.` };
        return { error: `${r.reason || 'Like non confirmé.'}${r.limit || r.blocked || r.paused ? ' Arrête-toi avec finish.' : ''}` };
      }
      case 'read_profile': {
        const p = await bot.readProfile();
        return { text: `Profil lu : ${JSON.stringify(p)}` };
      }
      case 'prepare_dm': {
        const dm = await bot.prepareDm(input.username, input.message);
        return { text: `Message tapé dans la conversation avec @${dm.username}, NON envoyé. L’utilisateur doit le confirmer dans l’app. Ne touche plus à cette conversation.` };
      }
      case 'wait': {
        const s = Math.max(1, Math.min(10, Number(input.seconds) || 2));
        await sleep(s * 1000 * (device.kind === 'sim' ? 0.2 : 1), this.signal);
        return { text: `Attente de ${s} s.` };
      }
      case 'finish':
        return { text: 'OK', finish: String(input.summary || '') };
      default:
        return { error: `Outil inconnu : ${name}` };
    }
  }

  /** Lance la mission. Renvoie le bilan. */
  async run(goal) {
    if (this.running) throw new Error('L’agent tourne déjà.');
    this.running = true;
    this.delay = null;
    try {
      const ai = this.ctx.settings();
      if (ai.provider === 'openrouter') return await this.runOpenRouter(goal, ai);
      return await this.runAnthropic(goal, ai);
    } finally {
      this.running = false;
    }
  }

  statusLine() {
    const st = this.ctx.guard.status();
    return `Limites du jour : ${st.today}/${st.daily} likes (${st.hour}/${st.hourly} cette heure)${st.paused ? `, PAUSE EN COURS : ${st.pauseReason}` : ''}.`;
  }

  async step(i, name, input) {
    this.ctx.event({ type: 'agent-step', step: i, tool: name, input });
    this.ctx.log('info', `Claude → ${name} ${JSON.stringify(input)}`);
    let r;
    try {
      r = await this.exec(name, input);
    } catch (e) {
      if (e instanceof StoppedError) throw e;
      r = { error: e.message };
    }
    if (r.error) this.ctx.log('warn', `Outil ${name} : ${r.error}`);
    this.ctx.event({ type: 'agent-result', step: i, tool: name, result: r });
    this.ctx.frame();
    return r;
  }

  // --- Claude (API Anthropic) ---------------------------------------------

  async runAnthropic(goal, ai) {
    const cfg = ai.anthropic;
    if (!cfg.apiKey) throw new AiError('Ajoute ta clé API Claude (sk-ant-…) dans Réglages.');
    const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: process.env.IGG_ANTHROPIC_BASE_URL || undefined, maxRetries: 2 });
    const model = cfg.model || 'claude-opus-5-5';
    const betas = ['context-management-2025-06-27'];
    const extra = {};
    if (FALLBACK_MODELS.has(model)) {
      betas.push('server-side-fallback-2026-07-01');
      extra.fallbacks = 'default';
    }
    const img = (o) => ({ type: 'image', source: { type: 'base64', media_type: o.image.mediaType, data: o.image.data.toString('base64') } });

    const first = await this.observe();
    // Historique en ajout seul : on ne modifie jamais un message déjà envoyé.
    const messages = [{ role: 'user', content: [{ type: 'text', text: `Mission : ${goal}\n${this.statusLine()}\n\n${this.observationText(first)}` }, img(first)] }];
    const maxSteps = Math.max(3, Math.min(80, Number(ai.maxSteps) || 25));

    for (let i = 1; i <= maxSteps; i++) {
      throwIfStopped(this.signal);
      this.ctx.event({ type: 'agent-thinking', step: i });
      let res;
      try {
        res = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          betas,
          ...extra,
          system: SYSTEM,
          tools: TOOLS,
          messages,
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: cfg.effort || 'medium' },
          cache_control: { type: 'ephemeral' },
          context_management: { edits: [{ type: 'clear_tool_uses_20250919', trigger: { type: 'input_tokens', value: 60000 }, keep: { type: 'tool_uses', value: 4 }, exclude_tools: ['finish'] }] },
        }, { signal: this.signal });
      } catch (e) {
        if (this.signal.aborted || e instanceof Anthropic.APIUserAbortError) throw new StoppedError();
        if (e instanceof Anthropic.AuthenticationError) throw new AiError('Claude : clé API refusée. Vérifie-la dans Réglages.');
        if (e instanceof Anthropic.PermissionDeniedError) throw new AiError(`Claude : accès refusé (${e.message}).`);
        if (e instanceof Anthropic.RateLimitError) throw new AiError('Claude : limite de débit atteinte, réessaie dans une minute.');
        if (e instanceof Anthropic.BadRequestError) throw new AiError(`Claude : requête refusée (${e.message}).`);
        if (e instanceof Anthropic.InternalServerError) throw new AiError('Claude est surchargé, réessaie dans un instant.');
        if (e instanceof Anthropic.APIConnectionError) throw new AiError('Impossible de joindre l’API Claude (connexion Internet ?).');
        throw e;
      }
      const u = res.usage || {};
      this.ctx.event({ type: 'agent-usage', step: i, usage: { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens }, model: res.model });

      for (const b of res.content) {
        if (b.type === 'thinking' && b.thinking) this.ctx.event({ type: 'agent-thought', step: i, text: b.thinking });
        if (b.type === 'text' && b.text.trim()) this.ctx.event({ type: 'agent-text', step: i, text: b.text });
        if (b.type === 'fallback') this.ctx.log('info', `Requête reprise par ${b.to?.model} (repli serveur).`);
      }
      if (res.stop_reason === 'refusal') {
        const why = res.stop_details?.explanation;
        throw new AiError(`Claude a décliné la mission${why ? ` : ${why}` : '.'}`);
      }
      messages.push({ role: 'assistant', content: res.content });
      if (res.stop_reason === 'pause_turn') continue;
      const calls = res.content.filter((b) => b.type === 'tool_use');
      if (res.stop_reason === 'max_tokens') throw new AiError('Réponse de Claude coupée (max_tokens).');
      if (!calls.length) {
        const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        return this.done(text || 'Mission terminée.', i);
      }

      const results = [];
      let finished = null;
      for (const c of calls) {
        const r = await this.step(i, c.name, c.input || {});
        if (r.finish !== undefined) finished = r.finish;
        results.push({ type: 'tool_result', tool_use_id: c.id, is_error: !!r.error, content: r.error || r.text });
      }
      if (finished !== null) return this.done(finished, i);
      await sleep(this.ctx.getDevice().kind === 'sim' ? 150 : 900, this.signal);
      const obs = await this.observe();
      // Le nouvel écran accompagne les résultats, dans le même message.
      results[results.length - 1].content = [{ type: 'text', text: `${results[results.length - 1].content}\n\n${this.statusLine()}\n${this.observationText(obs)}` }, img(obs)];
      messages.push({ role: 'user', content: results });
    }
    return this.done(`Nombre maximal d’étapes atteint (${maxSteps}). Relance l’agent pour continuer.`, maxSteps);
  }

  done(summary, steps) {
    this.ctx.log('ok', `Agent terminé en ${steps} étape(s) : ${summary}`);
    this.ctx.event({ type: 'agent-done', summary, steps });
    return { summary, steps };
  }

  // --- OpenRouter (format compatible OpenAI) ---------------------------------

  async runOpenRouter(goal, ai) {
    const cfg = ai.openrouter;
    if (!cfg.apiKey) throw new AiError('Connecte OpenRouter ou colle ta clé (sk-or-…) dans Réglages.');
    const url = `${process.env.IGG_OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'}/chat/completions`;
    const tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    const userObs = (prefix, o) => ({ role: 'user', content: [{ type: 'text', text: `${prefix}${this.statusLine()}\n${this.observationText(o)}` }, { type: 'image_url', image_url: { url: `data:${o.image.mediaType};base64,${o.image.data.toString('base64')}` } }] });
    const messages = [{ role: 'system', content: SYSTEM }, userObs(`Mission : ${goal}\n`, await this.observe())];
    const maxSteps = Math.max(3, Math.min(80, Number(ai.maxSteps) || 25));

    for (let i = 1; i <= maxSteps; i++) {
      throwIfStopped(this.signal);
      this.ctx.event({ type: 'agent-thinking', step: i });
      let data;
      try {
        const res = await fetch(url, {
          method: 'POST',
          signal: this.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}`, 'HTTP-Referer': 'https://github.com/lburdier/instagrowth', 'X-Title': 'InstaGrowth Desktop' },
          body: JSON.stringify({ model: cfg.model || 'anthropic/claude-opus-5.5', max_tokens: 4000, messages, tools, tool_choice: 'auto' }),
        });
        data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new AiError(`OpenRouter : ${data?.error?.message || `HTTP ${res.status}`}`);
      } catch (e) {
        if (this.signal.aborted) throw new StoppedError();
        throw e instanceof AiError ? e : new AiError(`OpenRouter injoignable : ${e.message}`);
      }
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new AiError('Réponse vide du modèle.');
      if (msg.content) this.ctx.event({ type: 'agent-text', step: i, text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) });
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      const calls = msg.tool_calls || [];
      if (!calls.length) return this.done(typeof msg.content === 'string' && msg.content.trim() ? msg.content.trim() : 'Mission terminée.', i);
      let finished = null;
      for (const c of calls) {
        let input = {};
        try { input = JSON.parse(c.function?.arguments || '{}'); } catch { /* arguments invalides */ }
        const r = await this.step(i, c.function?.name, input);
        if (r.finish !== undefined) finished = r.finish;
        messages.push({ role: 'tool', tool_call_id: c.id, content: r.error ? `Erreur : ${r.error}` : r.text });
      }
      if (finished !== null) return this.done(finished, i);
      await sleep(this.ctx.getDevice().kind === 'sim' ? 150 : 900, this.signal);
      messages.push(userObs('Nouvel écran.\n', await this.observe()));
    }
    return this.done(`Nombre maximal d’étapes atteint (${maxSteps}).`, maxSteps);
  }
}

/** Liste des modèles OpenRouter capables de voir une image et d'utiliser des outils. */
export async function listOpenRouterVisionModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  const { data = [] } = await res.json();
  return data
    .filter((m) => (m.architecture?.input_modalities || []).includes('image') && (m.supported_parameters || []).includes('tools'))
    .map((m) => ({ id: m.id, label: `${m.name}${m.id.endsWith(':free') ? ' — gratuit' : ''}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Test rapide de la clé (un mot de réponse). */
export async function testAi(ai) {
  if (ai.provider === 'openrouter') {
    const res = await fetch(`${process.env.IGG_OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.openrouter.apiKey}` },
      body: JSON.stringify({ model: ai.openrouter.model, max_tokens: 20, messages: [{ role: 'user', content: 'Réponds simplement OK.' }] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new AiError(`OpenRouter : ${data?.error?.message || `HTTP ${res.status}`}`);
    return data.choices?.[0]?.message?.content || 'OK';
  }
  const client = new Anthropic({ apiKey: ai.anthropic.apiKey, baseURL: process.env.IGG_ANTHROPIC_BASE_URL || undefined });
  try {
    const r = await client.messages.create({ model: ai.anthropic.model || 'claude-opus-5-5', max_tokens: 2000, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Réponds simplement « OK ».' }] });
    if (r.stop_reason === 'refusal') throw new AiError('Claude a décliné le test.');
    return r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim() || 'OK';
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('Clé API refusée.');
    if (e instanceof Anthropic.APIError) throw new AiError(`Claude : ${e.message}`);
    throw e;
  }
}
