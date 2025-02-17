import axios, { AxiosError } from 'axios';
// import * as cheerio from 'cheerio';
// import { Readability } from '@mozilla/readability';
// import { JSDOM } from 'jsdom';

const logger = console; // Consider using a more robust logger

export class SearXNGClient {
    private base_url = process.env.SEARXNG_BASE_URL;
    private headers = {
        // "X-Searx-API-Key": "f9f07f93b37b8483aadb5ba717f556f3a4ac507b281b4ca01e6c6288aa3e3ae5",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Authorization": ""
    };
    

    private default_engines = ["google", "bing", "duckduckgo", "brave"];
    private num_results = 10;
    private timeout = 10;
    // private parsingTimeout = 15;  // Seconds
    // private max_content_length = 50000; // characters before trimming at a later stage (token level)
    // private max_workers = 5;

    private languagesList: { [char: string]: string } = {
        "english": "en",
        "spanish": "es",
        "french": "fr",
        "german": "de",
        "italian": "it",
        "dutch": "nl",
        "portuguese": "pt",
        "russian": "ru",
        "chinese": "zh",
        "japanese": "ja",
        "korean": "ko",
        "arabic": "ar",
        "turkish": "tr",
        "vietnamese": "vi",
        "thai": "th",
    }

    constructor(){
        
        if(!this.base_url){
            throw new Error("SEARXNG_BASE_URL environment variable is not set.");
        }

        if(!process.env.SEARXNG_AUTH){
            throw new Error("SEARXNG_AUTH environment variable is not set.");
        }

        const usernamePasswordBuffer = Buffer.from(process.env.SEARXNG_AUTH);
        const base64data = usernamePasswordBuffer.toString('base64');
        this.headers["Authorization"] = `Basic ${base64data}`;
    }

    async search(query: string, language: string = "English"): Promise<{
        results: {
            url: string;
            title: string;
            content: string;
            engine: string;
            template: string;
            parsed_url: string[];
            engines: string[];
            positions: number[];
            thumbnail: string;
            publishedDate: string;
            score: number;
            category: string;
        }[];
    }> {
        const searchLanguage = this.languagesList[language.toLowerCase()] || "en";

        const params = {
            "q": query,
            "format": "json",
            "language": searchLanguage,
            "engines": this.default_engines.join(","),
            "results": this.num_results
        };

        try {
            logger.log(`SearXNGClient: Performing search with query "${query}"`);
            const response = await axios.get(`${this.base_url}/search`, {
                headers: this.headers,
                params,
                timeout: this.timeout * 1000,
            });

            // Axios automatically throws for status codes outside 200-299
            logger.log(`SearXNGClient: Search request successful with status ${response.status}`);
            // logger.log(`SearXNGClient: Search response data: ${JSON.stringify(response.data)}`);
            return response.data;

        } catch (error: any) {
            let errorMessage = "An unexpected error occurred during the search.";
            if (axios.isAxiosError(error)) {
                const axiosError: AxiosError = error;
                errorMessage = `Axios error during SearXNG search: ${axiosError.message}. Status code: ${axiosError.response?.status || 'N/A'}`;
                if (axiosError.response) {
                    logger.error(`Response data: ${JSON.stringify(axiosError.response.data)}`)
                }
            } else {
                errorMessage = `Non-Axios error during SearXNG search: ${error.message}`;
            }
            logger.error(errorMessage);
            return { results: [] };
        }
    }

    // async _fetch_url_content(url: string): Promise<string | null> {
    //     try {
    //         logger.log(`SearXNGClient: Fetching content from URL: ${url}`);
    //         const response = await axios.get(url, {
    //             headers: this.headers,
    //             timeout: this.timeout * 1000,
    //         });
    //         // Removed response.raise()
    //         logger.log(`SearXNGClient: Successfully fetched content from ${url}`);
    //         return response.data;
    //     } catch (error: any) {
    //         let errorMessage = `Error fetching ${url}: An unexpected error occurred.`;

    //         if (axios.isAxiosError(error)) {
    //             const axiosError: AxiosError = error;
    //             errorMessage = `Axios error during content fetch from ${url}: ${axiosError.message}. Status code: ${axiosError.response?.status || 'N/A'}`;
    //             if (axiosError.response) {
    //                 logger.error(`Response data: ${JSON.stringify(axiosError.response.data)}`);
    //             }
    //         } else {
    //             errorMessage = `Non-Axios error during content fetch from ${url}: ${error.message}`;
    //         }
    //         logger.error(errorMessage);
    //         return null;
    //     }
    // }

    // async _parse_content(html: string, url: string): Promise<{ url: string; content: string } | null> {
    //   if (!html) {
    //     logger.warn(`SearXNGClient: No HTML provided for parsing from URL: ${url}`);
    //     return null;
    //   }

    //   try {
    //     logger.log(`SearXNGClient: Parsing content from URL: ${url}`);

    //     const parsingPromise = new Promise<{ url: string; content: string } | null>(
    //       (resolve, reject) => {
    //         try {
    //           const dom = new JSDOM(html, { url });
    //           const document = dom.window.document;

    //           const reader = new Readability(document);
    //           const article = reader.parse();

    //           let content = article?.textContent;

    //           if (!content) {
    //             logger.warn(
    //               `SearXNGClient: Readability failed to extract content from ${url}, falling back to Cheerio`,
    //             );
    //             const $ = cheerio.load(html);
    //             $('script, style, nav, footer, header').remove();
    //             content = $('body').text().replace(/\s+/g, ' ').trim();
    //           }

    //           if (!content) {
    //             logger.warn(
    //               `SearXNGClient: Cheerio also failed to extract content from ${url}`,
    //             );
    //             resolve(null);
    //           }
    //           logger.log(`SearXNGClient: Successfully parsed content from ${url}`);

    //           resolve({
    //             url: url,
    //             content: content.slice(0, this.max_content_length), // Truncate after successful parsing
    //           });
    //         } catch (error: any) {
    //           logger.error(`Error parsing content from ${url}: ${error.message}`);
    //           reject(error);
    //         }
    //       },
    //     );

    //     // Add Timeout
    //     const timeoutPromise = new Promise<{ url: string; content: string } | null>(
    //       (resolve) => {
    //         setTimeout(() => {
    //           logger.warn(`SearXNGClient: Parsing timed out for URL: ${url}`);
    //           resolve(null); // Resolve with null on timeout
    //         }, this.parsingTimeout * 1000);
    //       },
    //     );

    //     // Race parsing against timeout
    //     return await Promise.race([parsingPromise, timeoutPromise]);
    //   } catch (error: any) {
    //     logger.error(`Error setting up parsing for ${url}: ${error.message}`);
    //     return null;
    //   }
    // }

    // async fetch_and_parse_results(results: any[]): Promise<any[]> {
    //     if (!results || !Array.isArray(results)) {
    //         logger.error("SearXNGClient: Invalid results format received. Expected an array.");
    //         return [];
    //     }

    //     const parsedResults: any[] = [];

    //     for (const result of results) {
    //         if (!result || typeof result !== 'object') {
    //             logger.warn("SearXNGClient: Skipping invalid result item: not an object");
    //             continue;
    //         }
    //         const url = result.url;

    //         if (typeof url !== 'string' || !this._is_valid_url(url)) {
    //             logger.warn(`SearXNGClient: Skipping result with invalid URL: ${url}`);
    //             continue;
    //         }

    //         try {
    //             const html = await this._fetch_url_content(url);
    //             if (html) {
    //                 const parsedContent = await this._parse_content(html, url); // Await the parsed content
    //                 if (parsedContent && parsedContent.content) {
    //                     parsedResults.push({ ...result, parsed_content: parsedContent.content });
    //                 }
    //             }
    //         } catch (error: any) {
    //             logger.error(`Error processing result for URL ${url}: ${error.message}`);
    //         }
    //     }

    //     return parsedResults;
    // }

    _is_valid_url(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch (e) {
            return false;
        }
    }

    // async search_and_parse(query: string, language: string = "en"): Promise<any[]> {
    //     try {
    //         logger.log(`SearXNGClient: Starting search and parse for query "${query}"`);
    //         const searchResults = await this.search(query, language);

    //         if (!searchResults || typeof searchResults !== 'object' || !searchResults.results || !Array.isArray(searchResults.results)) {
    //             logger.error("SearXNGClient: Invalid searchResults format received. Expected an object with a 'results' array.");
    //             return [];
    //         }

    //         const results = searchResults.results;
    //         const parsedResults = await this.fetch_and_parse_results(results);
    //         logger.log(`SearXNGClient: Successfully completed search and parse for query "${query}"`);
    //         return parsedResults;
    //     } catch (error: any) {
    //         logger.error(`Error during search_and_parse for query "${query}": ${error.message}`);
    //         return [];
    //     }
    // }
}