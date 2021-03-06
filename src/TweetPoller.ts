import { Observable } from 'rxjs/Observable';
import { EmptyObservable } from 'rxjs/observable/EmptyObservable';
import { forkJoin } from 'rxjs/observable/forkJoin';
import { of } from 'rxjs/observable/of';
import { flatMap, retry } from 'rxjs/operators';

import { Logger, LoggerFactory } from '@codificationorg/commons-core';

import { PollingCheckpoint, TweetProcessor } from './';
import { APIGateway } from './APIGateway';
import { AppConfig } from './AppConfig';

const Logger = LoggerFactory.getLogger();

export class TweetPoller {
  private config: AppConfig;
  private apiGateway: APIGateway;
  private processor: TweetProcessor;
  private checkpoint: PollingCheckpoint;

  constructor(config: AppConfig, apiGateway: APIGateway, checkpoint: PollingCheckpoint, processor: TweetProcessor) {
    this.config = config;
    this.processor = processor;
    this.checkpoint = checkpoint;
    this.apiGateway = apiGateway;
  }

  public poll(): void {
    this.doPoll().subscribe(
      pollResults => {
        this.processor.process(pollResults);
      },
      err => Logger.error('Polling encountered an error: ', err),
    );
  }

  public doPoll(): Observable<any[]> {
    return forkJoin(this.getLastestTweets(), this.checkpoint.getLastTweetDate()).pipe(
      flatMap(results => {
        const lastTweetDate = results[1];
        Logger.debug(`Received previous last tweet date: ${new Date(lastTweetDate).toUTCString()}`);

        Logger.debug('Total tweets: ', results.length);
        const newTweets = this.sortTweets(results[0]).filter(tweet => Date.parse(tweet.created_at) > lastTweetDate);
        Logger.debug('New tweets: ', newTweets.length);

        if (newTweets.length < 1) {
          Logger.debug('Exiting, no new tweets detected.');
          return new EmptyObservable();
        } else {
          const currentLatestTweetDate = Date.parse(newTweets[0].created_at);
          Logger.debug(`Updating checkpoint timestamp: ${new Date(currentLatestTweetDate).toUTCString()}`);
          this.checkpoint.setLastTweetDate(currentLatestTweetDate);
          return of(newTweets);
        }
      }),
    );
  }

  private getLastestTweets(): Observable<any[]> {
    const query = `q=${this.config.searchQuery}${
      this.config.additionalParameters ? '&' + this.config.additionalParameters : ''
    }`;
    Logger.trace(`Using query string: ${query}`);
    return this.apiGateway.callAPI(`/search/tweets.json`, query).pipe(retry(3));
  }

  private sortTweets(tweets: any[]): any[] {
    return tweets.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }
}
