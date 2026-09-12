import { ProjectIndex, SearchResult } from "../models/types";
import { SearchEngine } from "../intelligence/SearchEngine";
export class SearchTool {
    private readonly engine = new SearchEngine();
    async execute(query: string, index: ProjectIndex, maxResults = 30): Promise<SearchResult[]> {
        return this.engine.search(query, index, maxResults);
    }
}
