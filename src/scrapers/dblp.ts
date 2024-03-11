import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";

import { PLExtAPI } from "paperlib-api";
import { Scraper, ScraperRequestType } from "./scraper";
import { isEmpty } from "@/utils/string";
import { DBLPVenueScraper } from "./dblp-venue";

interface ResponseType {
  result: {
    hits: {
      "@sent": number;
      hit: {
        info: {
          title: string;
          authors: {
            author:
              | {
                  "@pid": string;
                  text: string;
                }
              | { text: string }[];
          };
          venue: string;
          year: string;
          type: string;
          key: string;
          volume: string;
          pages: string;
          number: string;
          publisher: string;
          doi?: string;
        };
      }[];
    };
  };
}

export class DBLPScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return (
      !isEmpty(paperEntityDraft.title)
    );
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    let dblpQuery = stringUtils.formatString({
      str: paperEntityDraft.title,
      removeStr: "&amp;",
    });
    dblpQuery = stringUtils
      .formatString({
        str: dblpQuery,
        removeStr: "&",
      })
      .replace("—", "-");

    const scrapeURL =
      "https://dblp.org/search/publ/api?q=" + dblpQuery + "&format=json";
    const headers = {};

    return { scrapeURL, headers, sim_threshold: 0.98};
  }

  static parsingProcess(rawResponse: string): PaperEntity[] {
    if (isEmpty(rawResponse)) {
      return [];
    }
    const response = JSON.parse(rawResponse) as ResponseType;
    const candidatePaperEntityDrafts: PaperEntity[] = [];

    if (response.result.hits["@sent"] > 0) {
      for (const hit of response.result.hits.hit) {
        const candidatePaperEntityDraft = new PaperEntity();

        const article = hit.info;
        const title = article.title.replace(/&amp;/g, "&").replace(/\.$/, "");

        const authorList: string[] = [];
        if (!article.authors.author) {
          continue;
        }
        const authorResponse = article.authors.author;

        if ("@pid" in authorResponse) {
          authorList.push(authorResponse.text.replace(/[0-9]/g, "").trim());
        } else {
          for (const author of authorResponse) {
            authorList.push(author.text.replace(/[0-9]/g, "").trim());
          }
        }
        const authors = authorList.join(", ");

        const pubTime = article.year;
        let pubType;
        if (article.type.includes("Journal")) {
          pubType = 0;
        } else if (article.type.includes("Conference")) {
          pubType = 1;
        } else if (article.type.includes("Book")) {
          pubType = 3;
        } else {
          pubType = 2;
        }
        const paperKey = article.key;
        const pubKey = article.key.split("/").slice(0, 2).join("/");
        const venueKey = article.venue;

        candidatePaperEntityDraft.title = title;
        candidatePaperEntityDraft.authors = authors;
        candidatePaperEntityDraft.pubTime = `${pubTime}`;
        candidatePaperEntityDraft.pubType = pubType;
        if (article.doi) {
          candidatePaperEntityDraft.doi = article.doi;
        }
        if (article.volume) {
          candidatePaperEntityDraft.volume = article.volume;
        }
        if (article.pages) {
          candidatePaperEntityDraft.pages = article.pages;
        }
        if (article.number) {
          candidatePaperEntityDraft.number = article.number;
        }
        if (article.publisher) {
          candidatePaperEntityDraft.publisher = article.publisher;
        }

        if (
          pubKey != "journals/corr" ||
          (pubKey == "journals/corr" && venueKey != "CoRR")
        ) {
          candidatePaperEntityDraft.publication =
            "dblp://" +
            JSON.stringify({
              venueID: pubKey == "journals/corr" ? venueKey : pubKey,
              paperKey: paperKey,
            });

        } else {
          candidatePaperEntityDraft.publication = "arXiv";
        }

        candidatePaperEntityDrafts.push(candidatePaperEntityDraft);
      }
    }

    return candidatePaperEntityDrafts;
  }

  static async _scrapeRequest(
    scrapeURL: string,
    headers: Record<string, string>,
  ) {
    const alterScrapeURL = scrapeURL.replace("dblp.org", "dblp.uni-trier.de");

    return await Promise.any(
      [
        PLExtAPI.networkTool.get(scrapeURL, headers, 1, 5000),
        PLExtAPI.networkTool.get(alterScrapeURL, headers, 1, 5000),
      ]
    );
  }

  static async scrape(paperEntityDraft: PaperEntity, force = false): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft) && !force) {
      return paperEntityDraft;
    }
    const { scrapeURL, headers, sim_threshold } =
      this.preProcess(paperEntityDraft);

    // Initial request
    const rawSearchResponse = await DBLPScraper._scrapeRequest(
      scrapeURL,
      headers,
    );

    let candidatepaperEntityDrafts = this.parsingProcess(rawSearchResponse.body);

    let updatedpaperEntityDraft = this.matchingProcess(
      paperEntityDraft,
      candidatepaperEntityDrafts,
      sim_threshold,
    );

    // Request by time
    if (!updatedpaperEntityDraft.publication.includes("dblp://")) {
      for (const timeOffset of [0, 1]) {
        const baseScrapeURL = scrapeURL.slice(
          0,
          scrapeURL.indexOf("&format=json"),
        );

        const year = parseInt(updatedpaperEntityDraft.pubTime);
        const offsetScrapeURL =
          baseScrapeURL + " " + `year:${year - timeOffset}` + "&format=json";

        const rawSearchResponse = await DBLPScraper._scrapeRequest(
          offsetScrapeURL,
          headers,
        );

        const candidatepaperEntityDrafts = this.parsingProcess(rawSearchResponse.body);

        updatedpaperEntityDraft = this.matchingProcess(
          updatedpaperEntityDraft,
          candidatepaperEntityDrafts,
          sim_threshold,
        );

        if (updatedpaperEntityDraft.publication.includes("dblp://")) {
          break;
        }
      }
    }

    // Request venue
    if (updatedpaperEntityDraft.publication.includes("dblp://")) {
      updatedpaperEntityDraft =
        await DBLPVenueScraper.scrape(updatedpaperEntityDraft);
    }

    return updatedpaperEntityDraft;
  }


}
