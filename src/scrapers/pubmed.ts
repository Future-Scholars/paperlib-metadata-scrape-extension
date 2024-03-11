import { XMLParser } from "fast-xml-parser";
import { PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";

import { isEmpty } from "@/utils/string";
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
    return !isEmpty(paperEntityDraft.title);
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=5&sort=relevance&term=${paperEntityDraft.title}`;

    const headers = {};

    return { scrapeURL, headers, sim_threshold: 0.95 };
  }

  static parsingProcess(rawResponse: string): PaperEntity[] {
    const response = xmlParser.parse(rawResponse) as ResponseType;

    const candidatePaperEntityDraft = new PaperEntity();

    candidatePaperEntityDraft.title =
      response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.ArticleTitle;
    candidatePaperEntityDraft.authors =
      response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.AuthorList.Author.map(
        (author) => {
          return `${author.ForeName} ${author.LastName}`;
        },
      ).join(", ");
    candidatePaperEntityDraft.publication =
      response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.Journal.Title;
    candidatePaperEntityDraft.volume = response.PubmedArticleSet.PubmedArticle
      .MedlineCitation.Article.Journal.JournalIssue.Volume
      ? `${response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.Journal.JournalIssue.Volume}`
      : candidatePaperEntityDraft.volume;
    candidatePaperEntityDraft.number = response.PubmedArticleSet.PubmedArticle
      .MedlineCitation.Article.Journal.JournalIssue.Issue
      ? `${response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.Journal.JournalIssue.Issue}`
      : candidatePaperEntityDraft.number;
    candidatePaperEntityDraft.pubTime = `${response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.Journal.JournalIssue.PubDate.Year}`;
    candidatePaperEntityDraft.pages = response.PubmedArticleSet.PubmedArticle
      .MedlineCitation.Article.Pagination
      ? response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article
          .Pagination.MedlinePgn
      : candidatePaperEntityDraft.pages;

    candidatePaperEntityDraft.doi = Array.isArray(
      response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article
        .ELocationID,
    )
      ? response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article.ELocationID.pop()
      : response.PubmedArticleSet.PubmedArticle.MedlineCitation.Article
          .ELocationID;
    candidatePaperEntityDraft.pubType = 0;

    return [candidatePaperEntityDraft];
  }

  static async scrape(
    paperEntityDraft: PaperEntity,
    force = false,
  ): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft) && !force) {
      return paperEntityDraft;
    }

    const { scrapeURL, headers, sim_threshold } =
      this.preProcess(paperEntityDraft);

    const idResponse = JSON.parse(
      (await PLExtAPI.networkTool.get(scrapeURL, headers, 1, 5000)).body,
    ) as {
      esearchresult: {
        idlist?: string[];
      };
    };

    if ((idResponse.esearchresult?.idlist?.length || 0) > 0) {
      const promises = idResponse.esearchresult.idlist?.map((id) =>
        PLExtAPI.networkTool.get(
          `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&retmax=2&sort=relevance&id=${id}`,
          headers,
          1,
          10000,
          false,
          true,
        ),
      ) || [];

      const rawRepoResponses = await Promise.all(promises);

      const candidatePaperEntityDrafts = [
        ...rawRepoResponses.map((response) => this.parsingProcess(response.body)),
      ].flat();

      const updatedPaperEntityDraft = this.matchingProcess(
        paperEntityDraft,
        candidatePaperEntityDrafts,
        sim_threshold,
      );

      return updatedPaperEntityDraft;
    }

    return paperEntityDraft;
  }
}
