// Faux serveur de l'API Claude pour les tests : il joue un scénario fixe
// (ouvrir #yoga, entrer dans une publication, essayer un tap interdit, liker,
// défiler, liker, préparer un DM, essayer d'envoyer, terminer) en lisant
// l'arbre UI que l'app lui envoie, et enregistre chaque requête reçue.
//   node scripts/mock-claude.mjs   → écoute sur un port libre et l'affiche

import http from 'node:http';
import { pathToFileURL } from 'node:url';

const findLine = (tree, re) => Number((tree.split('\n').find((l) => re.test(l)) || '').match(/^\[(\d+)\]/)?.[1]);

function lastTree(body) {
  const last = body.messages[body.messages.length - 1];
  const blocks = Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }];
  const texts = [];
  for (const b of blocks) {
    if (b.type === 'text') texts.push(b.text);
    if (b.type === 'tool_result') for (const c of Array.isArray(b.content) ? b.content : [{ type: 'text', text: b.content }]) if (c.type === 'text') texts.push(c.text);
  }
  return texts.join('\n');
}

const SCRIPT = [
  () => ['open_hashtag', { tag: 'yoga' }, 'Je commence par ouvrir la page du hashtag #yoga.'],
  (t) => ['tap_element', { element: findLine(t, /id=image_button/) }, 'J’ouvre la première publication de la grille.'],
  (t) => ['tap_element', { element: findLine(t, /id=row_feed_button_like/) }, 'Je touche le cœur directement.'],
  (t) => ['like_post', { element: findLine(t, /id=row_feed_button_like/) }, 'Le tap direct est refusé : je passe par like_post.'],
  () => ['swipe', { direction: 'up' }, 'Publication suivante.'],
  (t) => ['like_post', { element: findLine(t, /desc="J’aime" id=row_feed_button_like/) }, 'Je like cette publication aussi.'],
  () => ['prepare_dm', { username: 'atelier.noa', message: 'Bonjour, vos pièces bleu nuit sont superbes.' }, 'Je prépare le message demandé.'],
  (t) => ['tap_element', { element: findLine(t, /id=row_thread_composer_send_button_container/) }, 'J’essaie d’envoyer.'],
  () => ['finish', { summary: '2 likes vérifiés sur #yoga et un message préparé pour @atelier.noa (à confirmer dans l’app).' }, 'Mission terminée.'],
];

export async function startMock({ port = 0 } = {}) {
  const requests = [];
  let step = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push({ body, headers: req.headers });
      const tree = lastTree(body);
      const [name, input, thought] = SCRIPT[Math.min(step, SCRIPT.length - 1)](tree);
      step++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: `msg_${step}`, type: 'message', role: 'assistant', model: body.model,
        content: [
          { type: 'thinking', thinking: thought, signature: `sig${step}` },
          { type: 'tool_use', id: `tu_${step}`, name, input },
        ],
        stop_reason: 'tool_use', stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: step > 1 ? 1000 : 0, cache_creation_input_tokens: 0 },
      }));
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const m = await startMock({ port: Number(process.argv[2]) || 0 });
  console.log(`Faux serveur Claude : ${m.url}  (IGG_ANTHROPIC_BASE_URL=${m.url})`);
}
