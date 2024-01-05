import { XMLParser } from "fast-xml-parser";

import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";

import { Scraper, ScraperRequestType } from "./scraper";

const xmlParser = new XMLParser();

interface ResponseType {
  feed: {
    entry?: {
      title: string;
      author: { name: string }[] | { name: string };
      published: string;
      "arxiv:comment": string;
    };
  };
}

export class ArXivScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return (
      paperEntityDraft.arxiv !== "" && paperEntityDraft.arxiv !== "undefined"
    );
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const arxivID = stringUtils.formatString({
      str: paperEntityDraft.arxiv,
      removeStr: "arXiv:",
    });
    const scrapeURL = `https://export.arxiv.org/api/query?id_list=${arxivID}`;

    const headers = {
      "accept-encoding": "UTF-32BE",
    };

    return { scrapeURL, headers };
  }

  static parsingProcess(
    rawResponse: { body: string },
    paperEntityDraft: PaperEntity,
  ): PaperEntity {
    const parsedResponse = xmlParser.parse(rawResponse.body) as ResponseType;

    const arxivResponse = parsedResponse.feed.entry;

    if (arxivResponse) {
      const title = arxivResponse.title;
      const authorList = arxivResponse.author || [];
      let authors: string;
      if (Array.isArray(authorList)) {
        authors = authorList
          .map((author) => {
            return author.name.trim();
          })
          .join(", ");
      } else {
        authors = authorList.name.trim();
      }

      const pubTime = arxivResponse.published.substring(0, 4);
      paperEntityDraft.title = title;
      paperEntityDraft.authors = authors;
      paperEntityDraft.pubTime = pubTime;
      paperEntityDraft.pubType = 0;
      paperEntityDraft.publication = "arXiv";
    }
    return paperEntityDraft;
  }
}
