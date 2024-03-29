import { PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { metadataUtils, stringUtils } from "paperlib-api/utils";

import { Scraper, ScraperRequestType } from "./scraper";

interface ResponseType {
  total_records: number;
  articles: {
    title: string;
    authors: {
      authors: {
        full_name: string;
      }[];
    };
    publication_year: string;
    content_type: string;
    publication_title: string;
    volume: string;
    publisher: string;
    start_page: string;
    end_page: string;
  }[];
}

export class IEEEScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    const IEEEAPIKey =
      (PLExtAPI.extensionPreferenceService.get(
        "@future-scholars/paperlib-metadata-scrape-extension",
        "ieee-scrapers-api-key",
      ) as string) || "";

    return (
      paperEntityDraft.title !== "" &&
      IEEEAPIKey !== "" &&
      !metadataUtils.isMetadataCompleted(paperEntityDraft)
    );
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const IEEEAPIKey =
      (PLExtAPI.extensionPreferenceService.get(
        "@future-scholars/paperlib-metadata-scrape-extension",
        "ieee-scrapers-api-key",
      ) as string) || "";

    let requestTitle = stringUtils.formatString({
      str: paperEntityDraft.title,
      removeNewline: true,
    });
    requestTitle = requestTitle.replace(/ /g, "+");
    const scrapeURL =
      "http://ieeexploreapi.ieee.org/api/v1/search/articles?apikey=" +
      IEEEAPIKey +
      "&format=json&max_records=25&start_record=1&sort_order=asc&sort_field=article_number&article_title=" +
      requestTitle;

    const headers = {
      Accept: "application/json",
    };

    return { scrapeURL, headers, sim_threshold: 0.95 };
  }

  static parsingProcess(rawResponse: string): PaperEntity[] {
    const response = JSON.parse(rawResponse) as ResponseType;
    const candidatePaperEntityDrafts: PaperEntity[] = [];
    if (response.total_records > 0) {
      for (const article of response.articles) {
        const candidatePaperEntityDraft = new PaperEntity();
        const title = article.title.replace(/&amp;/g, "&");
        const authors = article.authors.authors
          .map((author) => {
            return author.full_name.trim();
          })
          .join(", ");

        const pubTime = article.publication_year;

        let pubType;
        if (
          article.content_type.includes("Journals") ||
          article.content_type.includes("Article")
        ) {
          pubType = 0;
        } else if (article.content_type.includes("Conferences")) {
          pubType = 1;
        } else if (article.content_type.includes("Book")) {
          pubType = 3;
        } else {
          pubType = 2;
        }

        const publication = article.publication_title;
        candidatePaperEntityDraft.title = title;
        candidatePaperEntityDraft.authors = authors;
        candidatePaperEntityDraft.pubTime = `${pubTime}`;
        candidatePaperEntityDraft.pubType = pubType;
        candidatePaperEntityDraft.publication = publication;
        if (article.volume) {
          candidatePaperEntityDraft.volume = article.volume;
        }
        if (article.start_page) {
          candidatePaperEntityDraft.pages = article.start_page;
        }
        if (article.end_page) {
          candidatePaperEntityDraft.pages =
            candidatePaperEntityDraft.pages + "-" + article.end_page;
        }
        if (article.publisher) {
          candidatePaperEntityDraft.publisher = article.publisher;
        }
        candidatePaperEntityDrafts.push(candidatePaperEntityDraft);
      }
    }
    return candidatePaperEntityDrafts;
  }
}
