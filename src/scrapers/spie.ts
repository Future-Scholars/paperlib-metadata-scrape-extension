import stringSimilarity from "string-similarity";

import { PaperEntity, metadataUtils, stringUtils } from "paperlib-api";

import { Scraper, ScraperRequestType } from "./scraper";

interface ResponseType {
  Items: {
    DOI: string;
    Issue?: string;
    JournalName?: string;
    PublicationDateTime: string;
    PublicationType: string;
    PublisherName: string;
    ParentTitle: string;
    StartPage?: string;
    EndPage?: string;
    Title: string;
    AuthorEditorLinks?: string;
    VolumeNumber: string;
  }[];
}

export class SPIEScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return (
      paperEntityDraft.title !== "" &&
      !metadataUtils.isMetadataCompleted(paperEntityDraft)
    );
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const title = stringUtils
      .formatString({
        str: paperEntityDraft.title,
        removeNewline: true,
      })
      .replace(" ", "+");
    const scrapeURL = `https://www.spiedigitallibrary.org/search?term=${title}`;
    const headers = {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",
    };

    return { scrapeURL, headers };
  }

  static parsingProcess(
    rawResponse: { body: string },
    paperEntityDraft: PaperEntity,
  ): PaperEntity {
    const resultsStr = rawResponse.body.match(/DisplayResults\(\[.*\]\);/g);
    if (resultsStr && resultsStr[0]) {
      const results = JSON.parse(
        resultsStr[0].replace("DisplayResults([", "").slice(0, -6),
      ) as ResponseType;

      for (const item of results.Items) {
        const plainHitTitle = stringUtils.formatString({
          str: item.Title,
          removeStr: "&amp;",
          removeSymbol: true,
          lowercased: true,
        });

        const existTitle = stringUtils.formatString({
          str: paperEntityDraft.title,
          removeStr: "&amp;",
          removeSymbol: true,
          lowercased: true,
        });

        const sim = stringSimilarity.compareTwoStrings(
          plainHitTitle,
          existTitle,
        );
        if (sim > 0.95) {
          paperEntityDraft.title = item.Title.replaceAll("&amp;", "&");
          paperEntityDraft.doi = item.DOI;

          if (item.PublicationType.toLowerCase().includes("journal")) {
            paperEntityDraft.pubType = 0;
          } else if (item.PublicationType.toLowerCase().includes("book")) {
            paperEntityDraft.pubType = 3;
          } else if (
            item.PublicationType.toLowerCase().includes("proceeding")
          ) {
            paperEntityDraft.pubType = 1;
          } else {
            paperEntityDraft.pubType = 2;
          }

          if (item.StartPage && item.EndPage) {
            paperEntityDraft.pages = `${item.StartPage}-${item.EndPage}`;
          }
          paperEntityDraft.publication =
            item.JournalName?.replaceAll("_", " ") || item.ParentTitle;
          paperEntityDraft.pubTime = `${new Date(
            item.PublicationDateTime,
          ).getFullYear()}`;
          paperEntityDraft.authors = item.AuthorEditorLinks
            ? item.AuthorEditorLinks.split(" ")
                .map((a) => a.trim().split("|")[0]?.replace("_", " "))
                .filter((a) => a)
                .join(", ")
            : "";
          paperEntityDraft.number = item.Issue || "";
          paperEntityDraft.volume = item.VolumeNumber;
          paperEntityDraft.publisher = item.PublisherName;

          break;
        }
      }
    }
    return paperEntityDraft;
  }
}
