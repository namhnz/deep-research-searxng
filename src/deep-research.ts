import FirecrawlApp, {
  BatchScrapeResponse,
  BatchScrapeStatusResponse,
  ScrapeResponse,
} from '@mendable/firecrawl-js';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';

import { generateObject, trimPrompt } from './ai';
import { OutputManager } from './output-manager';
import { systemPrompt } from './prompt';
// Import the SearXNGClient (assuming it's in searxng_client.ts)
import { SearXNGClient } from './searxng_client'; // Adjust the path as needed
import { blacklistedWebDomains, isFile } from './blacklisted-rules';

// Initialize output manager for coordinated console/progress output
const output = new OutputManager();

// Replace console.log with output.log
function log(...args: any[]) {
  output.log(...args);
}

export type ResearchProgress = {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
};

type SerpQuery = {
  query: string;
  researchGoal: string;
};

type ProcessedResult = {
  learnings: string[];
  followUpQuestions: string[];
};

type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
};

// increase this if you have higher API rate limits
const ConcurrencyLimit = 2;

// Initialize SearXNG Client:
const searx = new SearXNGClient();

// Initialize Firecrawl with optional API key and optional base url

const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

// take en user query, return a list of SERP queries
async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
  language = 'English',
}: {
  query: string;
  numQueries?: number;

  // optional, if provided, the research will continue from the last learning
  learnings?: string[];
  language?: string;
}) {
  const res = await generateObject({
    system: systemPrompt({ language }),
    prompt: `Given the following prompt from the user, generate a list of SERP queries to research the topic. Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear. Make sure each query is unique and not similar to each other: <prompt>${query}</prompt>\n\n${
      learnings
        ? `Here are some learnings from previous research, use them to generate more specific queries: ${learnings.join(
            '\n',
          )}`
        : ''
    }`,
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().describe('The SERP query'),
            researchGoal: z
              .string()
              .describe(
                'First talk about the goal of the research that this query is meant to accomplish, then go deeper into how to advance the research once the results are found, mention additional research directions. Be as specific as possible, especially for additional research directions.',
              ),
          }),
        )
        .describe(`List of SERP queries, max of ${numQueries}`),
    }),
  });
  log(`Created ${res.object.queries.length} queries`, res.object.queries);

  return res.object.queries.slice(0, numQueries);
}

async function processSerpResult({
  query,
  results, // Changed from result: SearchResponse to results: any[]
  numLearnings = 3,
  numFollowUpQuestions = 3,
  language = 'English',
}: {
  query: string;
  results: ScrapeResponse[];
  numLearnings?: number;
  numFollowUpQuestions?: number;
  language?: string;
}) {
  const contents = compact(results.map(item => item.markdown)).map(content =>
    trimPrompt(content, 25_000),
  );
  log(`Ran ${query}, found ${contents.length} contents`);

  const res = await generateObject({
    abortSignal: AbortSignal.timeout(60_000),
    system: systemPrompt({ language }),
    prompt: `Given the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and information dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates. The learnings will be used to research the topic further.\n\n<contents>${contents
      .map(content => `<content>\n${content}\n</content>`)
      .join('\n')}</contents>`,
    schema: z.object({
      learnings: z
        .array(z.string())
        .describe(`List of learnings, max of ${numLearnings}`),
      followUpQuestions: z
        .array(z.string())
        .describe(
          `List of follow-up questions to research the topic further, max of ${numFollowUpQuestions}`,
        ),
    }),
  });
  log(`Created ${res.object.learnings.length} learnings`, res.object.learnings);

  return res.object;
}

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
  language = 'English',
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
  language: string;
}) {
  const learningsString = trimPrompt(
    learnings
      .map(learning => `<learning>\n${learning}\n</learning>`)
      .join('\n'),
    150_000,
  );

  const res = await generateObject({
    system: systemPrompt({ language }),
    prompt: `Write a comprehensive research report on the following topic, incorporating ALL provided research findings. The report should be detailed, professional, and well-structured with clear sections.\n\nUser query:\n<prompt>${prompt}</prompt>\n\nResearch findings:\n<learnings>\n${learningsString}\n</learnings>\n\nGuidelines:\n- Aim for 3 or more pages of detailed content\n- Include an executive summary at the start\n- Organize findings into logical sections with clear headings\n- Synthesize and connect related learnings\n- Use professional, academic writing style\n- Format text appropriately using markdown`,
    schema: z.object({
      reportMarkdown: z
        .string()
        .describe('Final report on the topic in Markdown'),
    }),
  });

  // Append the visited URLs section to the report
  const urlsSection = `\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
  return res.object.reportMarkdown + urlsSection;
}

export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
  language,
  onProgress,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  language: string;
  onProgress?: (progress: ResearchProgress) => void;
}): Promise<ResearchResult> {
  const progress: ResearchProgress = {
    currentDepth: depth,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    totalQueries: 0,
    completedQueries: 0,
  };

  const reportProgress = (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update);
    onProgress?.(progress);
  };

  const serpQueries = await generateSerpQueries({
    query,
    learnings,
    numQueries: breadth,
  });

  reportProgress({
    totalQueries: serpQueries.length,
    currentQuery: serpQueries[0]?.query,
  });

  const limit = pLimit(ConcurrencyLimit);

  const results = await Promise.all(
    serpQueries.map((serpQuery: SerpQuery) =>
      limit(async () => {
        try {
          // Use SearXNGClient instead of Firecrawl
          const searchResults = await searx.search(serpQuery.query, language);
          const foundUrls = searchResults.results.map(item => item.url);
          log(`Scraping max 5 items in list URLs: ${foundUrls.join(', ')}`);

          let successScrapedUrlsCount: number = 0;
          const successScrapedResults: ScrapeResponse[] = [];
          for (const url of foundUrls) {
            // Loại bỏ các trang không thể scrape nội dung văn bản
            if(blacklistedWebDomains.some(domain => url.includes(domain))) {
              log(`Skipping blacklisted (no text content) URL: ${url}`);
              continue;
            }
            // Loại bỏ các file pdf
            if(isFile(url)) {
              log(`Skipping file URL: ${url}`);
              continue;
            }

            log(`====>${successScrapedUrlsCount + 1}: Scraping URL: ${url}`);
            try {
              const scrapeResult = await firecrawl.scrapeUrl(url, {
                formats: ['markdown'],
                excludeTags: ['#ad', '#footer', '#nav', '#header'],
                blockAds: true,
                timeout: 60_000,
                waitFor: 30_000,
                onlyMainContent: true,
              });
              if (
                scrapeResult.success &&
                scrapeResult.metadata?.statusCode === 200
              ) {
                successScrapedResults.push(scrapeResult);
                successScrapedUrlsCount++;
                if (successScrapedUrlsCount >= 5) {
                  break;
                }
              }
            } catch (error) {
              log(`Error scraping URL: ${url}`, error);
            }
          }

          // // Scrape multiple websites (synchronous):
          // const batchScrapeResult = await firecrawl.batchScrapeUrls(
          //   limitedUrls,
          //   {
          //     formats: ['markdown'],
          //     excludeTags: ['#ad', '#footer', '#nav', '#header'],
          //     blockAds: true,
          //     timeout: 30_000,
          //   },
          // );

          // if (!batchScrapeResult.success) {
          //   throw new Error(`Failed to scrape: ${batchScrapeResult.error}`);
          // }
          // Output all the results of the batch scrape:
          // console.log(batchScrapeResult);

          // Collect URLs from this search
          const newUrls = compact(
            successScrapedResults.map(item => item.metadata?.sourceURL),
          );
          const newBreadth = Math.ceil(breadth / 2);
          const newDepth = depth - 1;

          const newLearnings = await processSerpResult({
            query: serpQuery.query,
            results: successScrapedResults, // Pass the SearXNG results
            numFollowUpQuestions: newBreadth,
          });
          const allLearnings = [...learnings, ...newLearnings.learnings];
          const allUrls = [...visitedUrls, ...newUrls];

          if (newDepth > 0) {
            log(
              `Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`,
            );

            reportProgress({
              currentDepth: newDepth,
              currentBreadth: newBreadth,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });

            const nextQuery = `
            Previous research goal: ${serpQuery.researchGoal}
            Follow-up research directions: ${newLearnings.followUpQuestions.map(q => `\n${q}`).join('')}
          `.trim();

            return deepResearch({
              query: nextQuery,
              breadth: newBreadth,
              depth: newDepth,
              learnings: allLearnings,
              visitedUrls: allUrls,
              language,
              onProgress,
            });
          } else {
            reportProgress({
              currentDepth: 0,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });
            return {
              learnings: allLearnings,
              visitedUrls: allUrls,
            };
          }
        } catch (e: any) {
          if (e.message && e.message.includes('Timeout')) {
            log(`Timeout error running query: ${serpQuery.query}: `, e);
          } else {
            log(`Error running query: ${serpQuery.query}: `, e);
          }
          return {
            learnings: [],
            visitedUrls: [],
          };
        }
      }),
    ),
  );

  return {
    learnings: [
      ...new Set(results.flatMap((r: ResearchResult) => r.learnings)),
    ],
    visitedUrls: [
      ...new Set(results.flatMap((r: ResearchResult) => r.visitedUrls)),
    ],
  };
}
