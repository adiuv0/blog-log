declare module "react-native-rss-parser" {
  export interface FeedItem {
    id?: string;
    title?: string;
    description?: string;
    links?: Array<{ url: string }>;
    published?: string;
    authors?: Array<{ name: string }>;
    categories?: Array<{ name: string }>;
  }

  export interface Feed {
    title?: string;
    description?: string;
    links?: Array<{ url: string }>;
    items: FeedItem[];
  }

  export function parse(xml: string): Promise<Feed>;
}
