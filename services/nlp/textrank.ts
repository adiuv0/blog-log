/**
 * TextRank extractive summarization.
 *
 * Algorithm:
 * 1. Split text into sentences
 * 2. Build a similarity graph (Jaccard similarity between sentence word sets)
 * 3. Run PageRank (~20 iterations)
 * 4. Extract top N sentences by rank, returned in document order
 *
 * No model download needed — pure algorithmic.
 * ~100ms per 5,000-word article on a modern phone.
 */

const SENTENCE_REGEX = /[^.!?\n]+[.!?\n]+/g;
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

function splitSentences(text: string): string[] {
  const matches = text.match(SENTENCE_REGEX);
  if (!matches) return [text];

  return matches
    .map((s) => s.trim())
    .filter((s) => {
      const words = s.split(/\s+/).length;
      return words >= 4 && words <= 100;
    });
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function pagerank(
  matrix: number[][],
  damping: number = 0.85,
  iterations: number = 20
): number[] {
  const n = matrix.length;
  if (n === 0) return [];

  let scores = new Array(n).fill(1 / n);

  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Array(n).fill((1 - damping) / n);

    for (let i = 0; i < n; i++) {
      let outSum = 0;
      for (let j = 0; j < n; j++) outSum += matrix[i][j];

      if (outSum > 0) {
        for (let j = 0; j < n; j++) {
          newScores[j] += damping * scores[i] * (matrix[i][j] / outSum);
        }
      }
    }

    scores = newScores;
  }

  return scores;
}

/**
 * Generate an extractive summary from article text.
 *
 * @param text - Plain text content (no HTML)
 * @param numSentences - Number of sentences to extract (default 3)
 * @returns Summary string with top-ranked sentences in document order
 */
export function summarize(text: string, numSentences: number = 3): string {
  const sentences = splitSentences(text);
  if (sentences.length <= numSentences) return sentences.join(" ");

  // Tokenize each sentence into a word set
  const wordSets = sentences.map((s) => new Set(tokenize(s)));

  // Build similarity matrix
  const n = sentences.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        matrix[i][j] = jaccardSimilarity(wordSets[i], wordSets[j]);
      }
    }
  }

  // Run PageRank
  const scores = pagerank(matrix);

  // Select top N sentences
  const ranked = scores
    .map((score, idx) => ({ score, idx }))
    .sort((a, b) => b.score - a.score)
    .slice(0, numSentences);

  // Return in document order
  return ranked
    .sort((a, b) => a.idx - b.idx)
    .map((r) => sentences[r.idx])
    .join(" ");
}

/**
 * Generate summaries for all articles that don't have one yet.
 * Designed to be called in the background after import.
 *
 * @param getArticles - Function that returns articles needing summaries
 * @param updateSummary - Function to save a generated summary
 * @param onProgress - Optional progress callback
 */
export async function generateSummariesBatch(
  getArticles: () => Array<{ id: string; contentText: string }>,
  updateSummary: (articleId: string, summary: string) => void,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const articlesNeedingSummary = getArticles();
  const total = articlesNeedingSummary.length;

  for (let i = 0; i < total; i++) {
    const article = articlesNeedingSummary[i];
    if (article.contentText && article.contentText.length > 100) {
      const summary = summarize(article.contentText);
      updateSummary(article.id, summary);
    }
    onProgress?.(i + 1, total);

    // Yield to event loop periodically to avoid blocking UI
    if (i % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}
