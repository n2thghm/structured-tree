import { App, TAbstractFile, TFile, TFolder } from "obsidian";

import { NoteMetadata } from "./note";
import { NoteTree } from "./noteTree";
import { InvalidRootModal } from "../modal/invalidRootModal";
import { generateUUID, getFolderFile } from "../utils";
import { ParsedPath } from "../path";
import { StructuredTreePluginSettings } from "../settings";
import moment from "moment";
import { NoteFinder } from "./noteFinder";
import { NoteRenamer } from "./noteRenamer";
import { getSupportedExtensions } from "src/supportedExtensions";

export interface VaultConfig {
  path: string;
  name: string;
}

export class StructuredVault {
  private _cachedAcceptedExtensions: Set<string>;
  folder: TFolder;
  tree: NoteTree;
  isIniatialized = false;
  noteFinder: NoteFinder;
  noteRenamer: NoteRenamer;

  constructor(
    public app: App,
    public config: VaultConfig,
    private settings: StructuredTreePluginSettings
  ) {
    this.tree = new NoteTree(settings);
    this.noteFinder = new NoteFinder(app);
    this.noteRenamer = new NoteRenamer(app, this.noteFinder, this.tree, this.settings);
    this.updateAcceptedExtensionsCache();
  }

  public resolveMetadata(file: TFile): NoteMetadata | undefined {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) return undefined;
    return frontmatter;
  }

  init() {
    if (this.isIniatialized) return;

    const root = getFolderFile(this.app.vault, this.config.path);
    if (!(root instanceof TFolder)) {
      new InvalidRootModal(this).open();
      return;
    }

    this.folder = root;

    for (const child of root.children)
      if (child instanceof TFile && this.isNote(child.extension))
        this.tree.addFile(child, this.settings).syncMetadata(this.resolveMetadata(child));

    this.tree.sort();
    this.isIniatialized = true;
  }

  async createRootFolder() {
    return await this.app.vault.createFolder(this.config.path);
  }

  async createNote(baseName: string) {
    const filePath = `${this.config.path}/${baseName}.md`;
    return await this.app.vault.create(filePath, "");
  }

  async generateFrontmatter(file: TFile) {
    if (!this.isNote(file.extension)) return;

    const note = this.tree.getFromFileName(file.basename, this.settings);

    if (!note) return false;

    return await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (this.settings.autoGenerateFrontmatter) {
        if (this.settings.generateId && !frontmatter.id) {
          frontmatter.id = generateUUID();
        }
        if (this.settings.generateTitle && !frontmatter[this.settings.titleKey]) {
          frontmatter[this.settings.titleKey] = note.title;
        }
        if (this.settings.generateDesc && frontmatter[this.settings.descKey] === undefined) {
          frontmatter[this.settings.descKey] = note.desc;
        }
        if (this.settings.generateCreated && !frontmatter[this.settings.createdKey]) {
          if (this.settings.createdFormat === "unix") {
            frontmatter[this.settings.createdKey] = file.stat.ctime;
          } else {
            frontmatter[this.settings.createdKey] = moment(file.stat.ctime).format("YYYY-MM-DD");
          }
        }
        if (this.settings.generateTags && !frontmatter.tags) {
          frontmatter.tags = [];
        }
      }
    });
  }

  public updateAcceptedExtensionsCache() {
    this._cachedAcceptedExtensions = getSupportedExtensions(this.settings.enableCanvasSupport);
  }

  get acceptedExtensions(): Set<string> {
    return this._cachedAcceptedExtensions;
  }

  isNote(extension: string) {
    return this.acceptedExtensions.has(extension);
  }

  onFileCreated(file: TAbstractFile): boolean {
    if (!(file instanceof TFile) || !this.isNote(file.extension)) return false;

    this.tree.addFile(file, this.settings, true).syncMetadata(this.resolveMetadata(file));
    return true;
  }

  onMetadataChanged(file: TFile): boolean {
    if (!this.isNote(file.extension)) return false;

    const note = this.tree.getFromFileName(file.basename, this.settings);
    if (!note) return false;

    note.syncMetadata(this.resolveMetadata(file));
    this.tree.updateNoteFile(note, file);
    return true;
  }

  onFileDeleted(parsed: ParsedPath): boolean {
    if (!this.isNote(parsed.extension)) return false;

    const note = this.tree.deleteByFileName(parsed.basename, this.settings);
    if (note?.parent) {
      note.syncMetadata(undefined);
    }
    return true;
  }
}
