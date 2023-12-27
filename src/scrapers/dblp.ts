import { PLAPI, PaperEntity, metadataUtils, stringUtils } from "paperlib-api";

import { bibtex2json } from "@/utils/bibtex";

import { Scraper, ScraperRequestType } from "./scraper";

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
      paperEntityDraft.title.replaceAll("&amp;", "").replaceAll("&", "") !==
        "" && !metadataUtils.isMetadataCompleted(paperEntityDraft)
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

    return { scrapeURL, headers };
  }

  static parsingProcess(
    rawResponse: { body: string },
    paperEntityDraft: PaperEntity,
  ): PaperEntity {
    const response = JSON.parse(rawResponse.body) as ResponseType;

    if (response.result.hits["@sent"] > 0) {
      for (const hit of response.result.hits.hit) {
        const article = hit.info;

        const plainHitTitle = stringUtils.formatString({
          str: article.title,
          removeStr: "&amp;",
          removeSymbol: true,
          removeNewline: true,
          removeWhite: true,
          lowercased: true,
        });

        const existTitle = stringUtils.formatString({
          str: paperEntityDraft.title,
          removeStr: "&amp;",
          removeSymbol: true,
          removeNewline: true,
          removeWhite: true,
          lowercased: true,
        });
        if (plainHitTitle != existTitle) {
          continue;
        } else {
          const title = article.title.replace(/&amp;/g, "&").replace(/\.$/, "");

          const authorList: string[] = [];
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

          if (
            pubKey != "journals/corr" ||
            (pubKey == "journals/corr" && venueKey != "CoRR")
          ) {
            if (article.doi) {
              paperEntityDraft.doi = article.doi;
            }
            paperEntityDraft.title = title;
            paperEntityDraft.authors = authors;
            paperEntityDraft.pubTime = `${pubTime}`;
            paperEntityDraft.pubType = pubType;
            paperEntityDraft.publication =
              "dblp://" +
              JSON.stringify({
                venueID: pubKey == "journals/corr" ? venueKey : pubKey,
                paperKey: paperKey,
              });

            if (article.volume) {
              paperEntityDraft.volume = article.volume;
            }
            if (article.pages) {
              paperEntityDraft.pages = article.pages;
            }
            if (article.number) {
              paperEntityDraft.number = article.number;
            }
            if (article.publisher) {
              paperEntityDraft.publisher = article.publisher;
            }
          }
          break;
        }
      }
    }

    return paperEntityDraft;
  }

  static async _scrapeRequest(
    scrapeURL: string,
    headers: Record<string, string>,
  ) {
    let rawSearchResponse: { body: string } | null;
    try {
      rawSearchResponse = (await PLAPI.networkTool.get(scrapeURL, headers)) as {
        body: string;
      };
    } catch (e) {
      console.error(e);
      rawSearchResponse = null;
    }

    if (!rawSearchResponse) {
      // Try an alternative URL
      const alternativeURL = scrapeURL.replace("dblp.org", "dblp.uni-trier.de");
      rawSearchResponse = (await PLAPI.networkTool.get(
        alternativeURL,
        headers,
      )) as { body: string };
    }

    return rawSearchResponse;
  }

  static async scrape(
    paperEntityDraft: PaperEntity,
    force = false,
  ): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft) && !force) {
      return paperEntityDraft;
    }

    const { scrapeURL, headers } = this.preProcess(paperEntityDraft);

    // Initial request
    const rawSearchResponse = await this._scrapeRequest(scrapeURL, headers);

    paperEntityDraft = this.parsingProcess(rawSearchResponse, paperEntityDraft);

    // Request by time
    for (const timeOffset of [0, 1]) {
      if (!paperEntityDraft.publication.includes("dblp://")) {
        const baseScrapeURL = scrapeURL.slice(
          0,
          scrapeURL.indexOf("&format=json"),
        );

        const year = parseInt(paperEntityDraft.pubTime);
        const offsetScrapeURL =
          baseScrapeURL + " " + `year:${year - timeOffset}` + "&format=json";

        const rawSearchResponse = await this._scrapeRequest(
          offsetScrapeURL,
          headers,
        );

        paperEntityDraft = this.parsingProcess(
          rawSearchResponse,
          paperEntityDraft,
        );
      }
    }

    // Request venue
    if (paperEntityDraft.publication.includes("dblp://")) {
      const { venueID, paperKey } = JSON.parse(
        paperEntityDraft.publication.replace("dblp://", ""),
      ) as { venueID: string; paperKey: string };
      const venueScrapeURL =
        "https://dblp.org/search/venue/api?q=" + venueID + "&format=json";

      const rawSearchResponse = await this._scrapeRequest(
        venueScrapeURL,
        headers,
      );

      // Try to fetch bib to handel workshop papers
      const bibURL = `https://dblp.org/rec/${paperKey}.bib?param=1`;
      const rawBibResponse = await this._scrapeRequest(bibURL, headers);

      paperEntityDraft = this.parsingProcessVenue(
        {
          apiResponse: rawSearchResponse,
          bibResponse: rawBibResponse,
        },
        paperEntityDraft,
        venueID,
      );
    }

    return paperEntityDraft;
  }

  static parsingProcessVenue(
    rawResponse: Record<string, { body: string }>,
    paperEntityDraft: PaperEntity,
    venueID: string,
  ): PaperEntity {
    const { apiResponse, bibResponse } = rawResponse;

    const response = JSON.parse(apiResponse.body) as {
      result: {
        hits: {
          "@sent": number;
          hit: {
            info: {
              url: string;
              venue: string;
            };
          }[];
        };
      };
    };

    if (response.result.hits["@sent"] > 0) {
      const hits = response.result.hits.hit;
      for (const hit of hits) {
        const venueInfo = hit["info"];
        if (venueInfo["url"].includes(venueID.toLowerCase())) {
          const venue = venueInfo["venue"];
          paperEntityDraft.publication = venue;
          break;
        } else {
          paperEntityDraft.publication = "";
        }
      }

      // handle workshop
      try {
        const bibtex = bibtex2json(bibResponse.body);
        if (bibtex[0]["container-title"].toLowerCase().includes("workshop")) {
          paperEntityDraft.publication =
            paperEntityDraft.publication + " Workshop";
          paperEntityDraft.pubType = 1;
        }
      } catch (e) {}
    } else {
      paperEntityDraft.publication = "";
    }
    return paperEntityDraft;
  }
}
