import { XMLParser } from "fast-xml-parser";
import { PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";
import stringSimilarity from "string-similarity";

import { Scraper, ScraperRequestType } from "./scraper";

const xmlParser = new XMLParser();

interface ResponseType {
  PubmedArticleSet: {
    PubmedArticle: {
      MedlineCitation: {
        Article: {
          Journal: {
            JournalIssue: {
              Volume: number;
              Issue: number;
              PubDate: { Year: number };
            };
            Title: string;
          };
          ArticleTitle: string;
          Pagination?: { MedlinePgn: string };
          ELocationID: string;
          AuthorList: {
            Author: {
              LastName: string;
              ForeName: string;
            }[];
          };
        };
      };
    };
  };
}

export class PubMedScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return paperEntityDraft.title !== "";
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=5&sort=relevance&term=${paperEntityDraft.title}`;

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
    const response = xmlParser.parse(rawResponse.body) as ResponseType;

    const plainHitTitle = stringUtils.formatString({
      str: response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article
        .ArticleTitle,
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

    const sim = stringSimilarity.compareTwoStrings(plainHitTitle, existTitle);
    if (sim > 0.95) {
      paperEntityDraft.title =
        response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.ArticleTitle;
      paperEntityDraft.authors =
        response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.AuthorList.Author.map(
          (author) => {
            return `${author.ForeName} ${author.LastName}`;
          },
        ).join(", ");
      paperEntityDraft.publication =
        response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.Journal.Title;
      paperEntityDraft.volume = `${response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.Journal.JournalIssue.Volume}`;
      paperEntityDraft.number = `${response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.Journal.JournalIssue.Issue}`;
      paperEntityDraft.pubTime = `${response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.Journal.JournalIssue.PubDate.Year}`;
      paperEntityDraft.pages = response.PubmedArticleSet.PubmedArticle
        .MedlineCitation.Article.Pagination
        ? response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article
            .Pagination.MedlinePgn
        : paperEntityDraft.pages;

      paperEntityDraft.doi = `${response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.ELocationID}`;
      paperEntityDraft.pubType = 0;
    }
    return paperEntityDraft;
  }

  static async scrape(
    paperEntityDraft: PaperEntity,
    force: boolean = false,
  ): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft) && !force) {
      return paperEntityDraft;
    }

    const { scrapeURL, headers } = this.preProcess(
      paperEntityDraft,
    ) as ScraperRequestType;

    const rawSearchResponse = await PLExtAPI.networkTool.get(
      scrapeURL,
      headers,
      1,
      10000,
      false,
      true,
    );

    const searchResponse = rawSearchResponse.body as {
      esearchresult: {
        idlist: string[];
      };
    };

    if (searchResponse.esearchresult.idlist.length > 0) {
      const id = searchResponse.esearchresult.idlist[0];

      if (id) {
        const rawRepoResponse = await PLExtAPI.networkTool.get(
          `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&retmax=20&sort=relevance&id=${id}`,
          headers,
          1,
          10000,
          false,
          true,
        );

        return this.parsingProcess(rawRepoResponse, paperEntityDraft);
      } else {
        return paperEntityDraft;
      }
    }

    return paperEntityDraft;
  }
}
