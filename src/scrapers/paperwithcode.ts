import { PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";
import stringSimilarity from "string-similarity";

import { isEmpty } from "@/utils/string";
import { Scraper, ScraperRequestType } from "./scraper";

interface ResponseType {
  count?: number;
  results: {
    url: string;
    is_official: boolean;
    stars: number;
  }[];
}

export class PwCScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return !isEmpty(paperEntityDraft.title);
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const connectedTitle = stringUtils
      .formatString({
        str: paperEntityDraft.title,
        removeStr: "&amp;",
        lowercased: true,
        trimWhite: true,
      })
      .replace(/ /g, "-")
      .replace(/\./g, "");
    const scrapeURL = `https://paperswithcode.com/api/v1/search/?q=${connectedTitle}`;

    const headers = {
      Accept: "application/json",
    };

    return { scrapeURL, headers, sim_threshold: 0.95 };
  }

  static async scrape(paperEntityDraft: PaperEntity, force = false): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft) && !force) {
      return paperEntityDraft;
    }

    const { scrapeURL, headers, sim_threshold } = this.preProcess(
      paperEntityDraft,
    ) as ScraperRequestType;

    const rawSearchResponse = await PLExtAPI.networkTool.get(
      scrapeURL,
      headers,
      1,
      5000,
    );

    const searchResponse = JSON.parse(rawSearchResponse.body) as {
      count?: number;
      results: {
        paper: {
          id: string;
          title: string;
          authors: string[];
        };
        repository: {
          url: string;
        };
        is_official: boolean;
      }[];
    };
    const targetTitle = this._matchingString(
      paperEntityDraft.title,
      paperEntityDraft.authors,
      false,
    );

    let id = "";
    if (searchResponse.count) {
      for (const result of searchResponse.results) {
        const matchedTitle = this._matchingString(
          result.paper.title,
          result.paper.authors[0],
          false,
        );

        if (
          stringSimilarity.compareTwoStrings(targetTitle, matchedTitle) >
            sim_threshold &&
          result.repository
        ) {
          id = result.paper.id;
          break;
        }
      }
    }

    if (id) {
      const rawRepoResponse = await PLExtAPI.networkTool.get(
        `https://paperswithcode.com/api/v1/papers/${id}/repositories/`,
        headers,
        1,
        5000,
      );

      const response = JSON.parse(rawRepoResponse.body) as {
        count?: number;
        results: {
          url: string;
          is_official: boolean;
          stars: number;
        }[];
      };

      if (response.count) {
        let codeList: string[] = [];

        const sortedResults = response.results.sort(
          (a, b) => b.stars - a.stars,
        );

        for (const result of sortedResults.slice(0, 3)) {
          codeList.push(
            JSON.stringify({
              url: result.url,
              isOfficial: result.is_official,
            }),
          );
        }
        codeList = codeList.sort((a, b) => {
          const aIsOfficial = JSON.parse(a).isOfficial;
          const bIsOfficial = JSON.parse(b).isOfficial;
          if (aIsOfficial && !bIsOfficial) {
            return -1;
          } else if (!aIsOfficial && bIsOfficial) {
            return 1;
          } else {
            return 0;
          }
        });
        paperEntityDraft.codes = codeList;
      }
      return paperEntityDraft;
    } else {
      return paperEntityDraft;
    }
  }
}
