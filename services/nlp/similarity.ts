/**
 * TF-IDF based similarity for topic linking.
 * Pure algorithmic fallback — no model download needed.
 *
 * For use when MiniLM-L6-v2 embeddings are not available.
 */

type TfIdfVector = Map<string, number>;

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "was", "are", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "this", "that",
  "these", "those", "i", "you", "he", "she", "it", "we", "they", "me",
  "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
  "what", "which", "who", "whom", "how", "when", "where", "why", "not",
  "no", "so", "if", "then", "than", "too", "very", "just", "about",
  "up", "out", "as", "into", "also", "more", "some", "such", "there",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Compute term frequency for a document.
 */
function computeTf(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  // Normalize by document length
  const len = tokens.length;
  for (const [key, val] of tf) {
    tf.set(key, val / len);
  }
  return tf;
}

/**
 * Compute inverse document frequency across a corpus.
 */
function computeIdf(documents: string[][]): Map<string, number> {
  const docCount = documents.length;
  const df = new Map<string, number>();

  for (const doc of documents) {
    const uniqueTerms = new Set(doc);
    for (const term of uniqueTerms) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log(docCount / (1 + count)));
  }
  return idf;
}

/**
 * Compute TF-IDF vector for a document.
 */
function computeTfIdf(tf: Map<string, number>, idf: Map<string, number>): TfIdfVector {
  const tfidf = new Map<string, number>();
  for (const [term, tfVal] of tf) {
    const idfVal = idf.get(term) ?? 0;
    tfidf.set(term, tfVal * idfVal);
  }
  return tfidf;
}

/**
 * Cosine similarity between two TF-IDF vectors.
 */
export function cosineSimilarity(a: TfIdfVector, b: TfIdfVector): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [key, val] of a) {
    normA += val * val;
    const bVal = b.get(key);
    if (bVal !== undefined) {
      dotProduct += val * bVal;
    }
  }
  for (const [, val] of b) {
    normB += val * val;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Cosine similarity between two float32 embedding vectors.
 */
export function embeddingCosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

export type ArticleForSimilarity = {
  id: string;
  contentText: string;
};

/**
 * Build TF-IDF vectors for a corpus of articles.
 * Returns a map from article ID to TF-IDF vector.
 */
export function buildTfIdfIndex(
  articles: ArticleForSimilarity[]
): Map<string, TfIdfVector> {
  const tokenized = articles.map((a) => tokenize(a.contentText));
  const idf = computeIdf(tokenized);

  const index = new Map<string, TfIdfVector>();
  for (let i = 0; i < articles.length; i++) {
    const tf = computeTf(tokenized[i]);
    index.set(articles[i].id, computeTfIdf(tf, idf));
  }
  return index;
}

/**
 * Find the top N most similar articles to a given article.
 *
 * @param articleId - The article to find similar articles for
 * @param index - TF-IDF index from buildTfIdfIndex
 * @param topN - Number of similar articles to return (default 5)
 * @returns Array of { id, score } sorted by descending similarity
 */
export function findSimilar(
  articleId: string,
  index: Map<string, TfIdfVector>,
  topN: number = 5
): Array<{ id: string; score: number }> {
  const sourceVector = index.get(articleId);
  if (!sourceVector) return [];

  const results: Array<{ id: string; score: number }> = [];

  for (const [id, vector] of index) {
    if (id === articleId) continue;
    const score = cosineSimilarity(sourceVector, vector);
    if (score > 0.01) {
      results.push({ id, score });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topN);
}

/**
 * Find similar articles using pre-computed embeddings (float32 arrays).
 */
export function findSimilarByEmbedding(
  targetEmbedding: Float32Array,
  allEmbeddings: Array<{ id: string; embedding: Float32Array }>,
  targetId: string,
  topN: number = 5
): Array<{ id: string; score: number }> {
  const results: Array<{ id: string; score: number }> = [];

  for (const { id, embedding } of allEmbeddings) {
    if (id === targetId) continue;
    const score = embeddingCosineSimilarity(targetEmbedding, embedding);
    if (score > 0.1) {
      results.push({ id, score });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topN);
}
