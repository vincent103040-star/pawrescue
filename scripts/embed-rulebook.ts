// One-off precompute script: embeds RULEBOOK_CORPUS with Gemini's embedding
// model and writes the vectors to data/rulebook_embeddings.json. Run this
// again only when rulebookCorpus.ts changes -- runtime queries just embed
// the user's question and compare against this precomputed file, so the
// corpus itself never needs re-embedding on every server start (saves API
// quota, which is scarce on the free tier).
import { writeFileSync, mkdirSync } from 'fs';
import { RULEBOOK_CORPUS } from '../src/data/rulebookCorpus';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Set GEMINI_API_KEY in the environment before running this script.');
  process.exit(1);
}

async function embedText(text: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } })
    }
  );
  const data: any = await res.json();
  if (!data.embedding?.values) {
    throw new Error(`Embedding failed for text starting "${text.slice(0, 20)}...": ${JSON.stringify(data)}`);
  }
  return data.embedding.values;
}

async function main() {
  const results = [];
  for (const chunk of RULEBOOK_CORPUS) {
    console.log(`Embedding: ${chunk.title}`);
    const embedding = await embedText(`${chunk.title}\n${chunk.text}`);
    results.push({ id: chunk.id, title: chunk.title, text: chunk.text, embedding });
  }
  mkdirSync('data', { recursive: true });
  writeFileSync('data/rulebook_embeddings.json', JSON.stringify(results));
  console.log(`Wrote ${results.length} embeddings to data/rulebook_embeddings.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
