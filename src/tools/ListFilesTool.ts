import { ProjectIndex } from "../models/types";
export class ListFilesTool {
    execute(index: ProjectIndex): string[] {
        return Array.from(index.files.keys());
    }
}
