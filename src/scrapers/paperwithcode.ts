import { PLAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";
import stringSimilarity from "string-similarity";

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
    return paperEntityDraft.title !== "";
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

    return { scrapeURL, headers };
  }

  static parsingProcess(
    rawResponse: { body: string },
    paperEntityDraft: PaperEntity,
  ): PaperEntity {
    const response = JSON.parse(rawResponse.body) as ResponseType;

    if (response.count) {
      let codeList: string[] = [];

      const sortedResults = response.results.sort((a, b) => b.stars - a.stars);

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
  }
  static async scrape(
    paperEntityDraft: PaperEntity,
    force = false,
  ): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft) && !force) {
      return paperEntityDraft;
    }

    const { scrapeURL, headers } = this.preProcess(paperEntityDraft);

    const rawSearchResponse = (await PLAPI.networkTool.get(
      scrapeURL,
      headers,
    )) as { body: string };

    const searchResponse = JSON.parse(rawSearchResponse.body) as {
      count?: number;
      results: {
        paper: {
          id: string;
          title: string;
        };
        repository: {
          url: string;
        };
        is_official: boolean;
      }[];
    };
    const targetTitle = stringUtils.formatString({
      str: paperEntityDraft.title,
      removeStr: "&amp;",
      removeSymbol: true,
      lowercased: true,
    });

    let id = "";
    if (searchResponse.count) {
      for (const result of searchResponse.results) {
        const hitTitle = stringUtils.formatString({
          str: result.paper.title,
          removeStr: "&amp;",
          removeSymbol: true,
          lowercased: true,
        });

        if (
          stringSimilarity.compareTwoStrings(hitTitle, targetTitle) > 0.98 &&
          result.repository
        ) {
          id = result.paper.id;
          break;
        }
      }
    }

    if (id) {
      const rawRepoResponse = (await PLAPI.networkTool.get(
        `https://paperswithcode.com/api/v1/papers/${id}/repositories/`,
        headers,
      )) as { body: string };

      return this.parsingProcess(rawRepoResponse, paperEntityDraft);
    } else {
      return paperEntityDraft;
    }
  }
}
