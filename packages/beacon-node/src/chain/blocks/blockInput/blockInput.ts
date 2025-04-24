import {
  ForkName,
  ForkPostDeneb,
  ForkPostElectra,
  // ForkPostFulu,
  ForkPreDeneb,
} from "@lodestar/params";
import {
  BlobIndex,
  SignedBeaconBlock,
  Slot,
  deneb,
  // fulu
} from "@lodestar/types";
import {fromHex, prettyBytes, toHex, withTimeout} from "@lodestar/utils";
import {prettyPrintArray} from "@lodestar/utils";
import {VersionedHashes} from "../../../execution/index.js";
import {kzgCommitmentToVersionedHash} from "../../../util/blobs.js";
import {byteArrayEquals} from "../../../util/bytes.js";
// import {CustodyConfig} from "../../../util/dataColumns.js";
import {BlockInputError, BlockInputErrorCode} from "./errors.js";
import {
  AddBlobProps,
  AddBlockProps,
  // AddColumnProps,
  BlobMeta,
  BlobWithSource,
  BlockInputBaseProps,
  BlockInputBlobsProps,
  // BlockInputColumnsProps,
  BlockInputDataStatus,
  BlockInputPreDataProps,
  BlockInputType,
  BlockWithSource,
  ColumnMeta,
  // ColumnWithSource,
  DataAvailabilityStatus,
  DataWithSource,
  LogMetaBasic,
  LogMetaBlobs,
  // LogMetaColumns,
  PossibleDataTypes,
  PromiseParts,
} from "./types.js";

export type BlockInputBlockType<Type extends BlockInputType> = Type extends BlockInputType.Blobs
  ? SignedBeaconBlock<ForkPostDeneb>
  : SignedBeaconBlock<ForkPreDeneb>;

export type BlockInputDataType<Type extends BlockInputType> = Type extends BlockInputType.Blobs
  ? deneb.BlobSidecar
  : null;

export type BlockInputLogMeta<Type extends BlockInputType> =
  // Type extends BlockInputType.Columns
  // ? LogMetaColumns
  // :
  Type extends BlockInputType.Blobs ? LogMetaBlobs : LogMetaBasic;

export function isBlockInputUnknown(bi: BlockInputBase): bi is BlockInput<BlockInputType.Unknown> {
  return bi.type === BlockInputType.Unknown;
}

export function isBlockInputPreData(blockInput: BlockInputBase): blockInput is BlockInput<BlockInputType.PreData> {
  return blockInput.type === BlockInputType.PreData;
}

export function isBlockInputBlobs(bi: BlockInputBase): bi is BlockInput<BlockInputType.Blobs> {
  return bi.type === BlockInputType.Blobs;
}

interface BlockInputBase {
  type: BlockInputType;
  get prettyRootHex(): string;
  rootHex: string;
  blockRoot: Uint8Array;
  getSlot(): Slot;
  getSlot(shouldError: boolean): Slot | undefined;
  getForkName(): ForkName;
  getParentRootHex(): string;
}

export class BlockInput<
  Type extends BlockInputType = BlockInputType,
  BlockType extends SignedBeaconBlock = BlockInputBlockType<Type>,
  DataType extends PossibleDataTypes = BlockInputDataType<Type>,
> implements BlockInputBase
{
  type: Type;
  rootHex: string;
  blockRoot: Uint8Array;

  // private readonly custodyConfig: Type extends BlockInputType.Columns ? CustodyConfig : never;

  private slot?: Slot;
  private forkName?: ForkName;
  private parentRootHex?: string;
  private versionHashes?: VersionedHashes;
  private dataStatus: BlockInputDataStatus = BlockInputDataStatus.NoData;
  private dataAvailability: DataAvailabilityStatus = DataAvailabilityStatus.PreData;

  private blockWithSource?: BlockWithSource<BlockType>;
  private dataCache = new Map<number, DataWithSource<DataType>>();

  private timeCreatedSec?: number;
  private timeCompleteSec?: number;

  private blockPromise = this.createPromise<BlockType>();
  private dataPromise = this.createPromise<DataType>();

  private isBlobsType(): this is BlockInput<BlockInputType.Blobs> & this {
    return this.type === BlockInputType.Blobs;
  }

  private isPreDataType(): this is BlockInput<BlockInputType.PreData> & this {
    return this.type === BlockInputType.PreData;
  }

  private isPreUnknownType(): this is BlockInput<BlockInputType.Unknown> & this {
    return this.type === BlockInputType.Unknown;
  }

  get prettyRootHex(): string {
    return prettyBytes(this.rootHex);
  }

  constructor(props: BlockInputBaseProps & {type: Type}) {
    this.type = props.type;
    this.checkForUndefinedProps({
      rootHex: props.rootHex,
      blockRoot: props.blockRoot,
    });
    this.rootHex = props.rootHex;
    this.blockRoot = props.blockRoot;
    // if ("block" in props) {
    //   this.timeCreatedSec = props.seenTimestampSec;
    //   this.addBlock(props);
    // } else {
    //   this.timeCreatedSec = Date.now() / 1000;
    // }
    // if ("block" in props && "blobSidecar" in props) {
    //   throw new BlockInputError({code: BlockInputErrorCode.INVALID_CONSTRUCTION, blockRoot: this.prettyRootHex});
    // }
    // if ("blobSidecar" in props) {
    //   this.addBlob(props);
    // }
    // this.custodyConfig = props.custodyConfig;
    // if ("block" in props && "columnSidecar" in props) {
    //   throw new BlockInputError({code: BlockInputErrorCode.INVALID_CONSTRUCTION, blockRoot: this.prettyRootHex});
    // }
    // if ("columnSidecar" in props) {
    //   this.addColumn(props);
    // }
  }

  /**
   *
   * Getters
   *
   */
  getSlot(): Slot;
  getSlot(shouldError: false): Slot | undefined;
  getSlot(shouldError = true): Slot | undefined {
    if (shouldError && !this.slot) {
      throw new BlockInputError({code: BlockInputErrorCode.MISSING_SLOT, blockRoot: this.prettyRootHex});
    }
    return this.slot;
  }

  getForkName(): ForkName {
    if (!this.forkName) {
      throw new BlockInputError({code: BlockInputErrorCode.MISSING_FORK_NAME, blockRoot: this.prettyRootHex});
    }
    return this.forkName;
  }

  getParentRootHex(): string;
  getParentRootHex(shouldError: false): string | undefined;
  getParentRootHex(shouldError = true): string | undefined {
    if (shouldError && !this.parentRootHex) {
      throw new BlockInputError({code: BlockInputErrorCode.MISSING_PARENT_ROOT_HEX, blockRoot: this.prettyRootHex});
    }
    return this.parentRootHex;
  }

  getDataStatus(): BlockInputDataStatus {
    return this.dataStatus;
  }

  getTimeComplete(): number {
    if (!this.timeCompleteSec) {
      throw new BlockInputError({
        code: BlockInputErrorCode.MISSING_TIME_COMPLETE,
        blockRoot: this.prettyRootHex,
      });
    }
    return this.timeCompleteSec;
  }

  // isComplete(): boolean {
  //   return this.hasBlock() && !this.needsData();
  // }

  getLogMeta(): BlockInputLogMeta<Type> {
    let meta = {
      blockRoot: this.prettyRootHex,
      slot: this.slot ?? "unknown",
    } as BlockInputLogMeta<Type>;
    if (isBlockInputBlobs(this)) {
      meta = {
        ...meta,
        expectedBlobs: `${this.blockWithSource?.block.message.body.blobKzgCommitments.length}`,
        receivedBlobs: this.dataCache.size,
      } as BlockInputLogMeta<BlockInputType.Blobs>;
    }
    // if (isBlockInputColumns(this)) {
    //   meta = {
    //     ...meta,
    //     expectedColumns: this.custodyConfig.sampledColumns.length,
    //     receivedColumns: this.getSampledColumns(false).length,
    //   } as BlockInputLogMeta<BlockInputType.Columns>;
    // }
    return meta;
  }

  /**
   *
   * Block related methods
   *
   */
  hasBlock(): boolean {
    return !!this.blockWithSource;
  }

  getBlock(): BlockType {
    return this.getBlockWithSource().block;
  }

  getBlockWithSource(): BlockWithSource<BlockType> {
    if (!this.blockWithSource) {
      throw new BlockInputError({code: BlockInputErrorCode.MISSING_BLOCK, blockRoot: this.prettyRootHex});
    }
    return this.blockWithSource;
  }

  addBlock(props: AddBlockProps<BlockType>): void {
    const {rootHex, blockRoot, forkName, dataAvailability, block, source, seenTimestampSec, peerIdStr} = props;
    this.checkForUndefinedProps({
      rootHex,
      blockRoot,
      forkName,
      dataAvailability,
      block,
      source,
      seenTimestampSec,
    });
    if (rootHex !== this.rootHex) {
      throw new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
          blockInputRoot: this.rootHex,
          mismatchedRoot: rootHex,
          source,
          peerId: `${peerIdStr}`,
        },
        "Cannot addBlock to BlockInput with a different rootHex"
      );
    }

    this.forkName = forkName;
    this.dataAvailability = dataAvailability;
    this.blockWithSource = {
      block,
      source,
      seenTimestampSec,
      peerIdStr,
    };
    this.slot = block.message.slot;
    this.parentRootHex = toHex(block.message.parentRoot);

    this.blockPromise.resolve(block);

    if (this.isBlobsType()) {
      const {block} = props as AddBlockProps<BlockInputBlockType<typeof this.type>>;

      this.versionHashes =
        this.blockWithSource?.block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash);
      for (const {sidecar} of this.dataCache.values()) {
        const err = this.checkBlockAndBlobArePaired(block, sidecar);
        if (err) {
          this.dataCache.delete(sidecar.index);
          // TODO: (@matthewkeil) spec says to ignore invalid blobs but should we downscore the peer maybe?
          // this.logger?.error(`Removing blobIndex=${blobSidecar.index} from BlockInput`, {}, err);
        }
      }
    }
    // if (isBlockInputColumns(this)) {
    //   for (const {sidecar} of this.dataCache.values()) {
    //     const err = this.checkBlockAndColumnArePaired(block, sidecar);
    //     if (err) {
    //       this.dataCache.delete(sidecar.index);
    //       // this.logger?.error(`Removing columnIndex=${sidecar.index} from BlockInput`, {}, err);
    //     }
    //   }
    // }

    if (!this.needsData()) {
      this.timeCompleteSec = Date.now();
    }
  }

  /**
   *
   * Data related methods
   *
   */
  // hasData(): boolean {
  //   return this.dataCache.size > 0;
  // }

  // needsData(): boolean {
  //   if (isBlockInputPreData(this)) {
  //     return false;
  //   }
  //   if (isBlockInputBlobs(this)) {
  //     return (
  //       this.dataAvailability === DataAvailabilityStatus.Available &&
  //       (!this.blockWithSource || this.blobsCache.size < this.numberOfBlobs())
  //     );
  //   }
  //   // if (isBlockInputColumns(this)) {
  //   //   return this.dataAvailability === DataAvailabilityStatus.Available && !!this.getMissingColumnMeta().length;
  //   // }
  //   throw new BlockInputError({code: BlockInputErrorCode.UNKNOWN_BLOCK_INPUT_TYPE, blockRoot: this.prettyRootHex});
  // }

  // getVersionHashes(): VersionedHashes;
  // getVersionHashes(shouldError: false): undefined | VersionedHashes;
  // getVersionHashes(shouldError = true): undefined | VersionedHashes {
  //   if (isBlockInputUnknown(this) || isBlockInputPreData(this)) {
  //     throw new BlockInputError(
  //       {code: BlockInputErrorCode.INVALID_BLOCK_INPUT_TYPE},
  //       "Cannot getVersionHashes for Unknown or PreData BlockInputType"
  //     );
  //   }
  //   if (!this.versionHashes || this.versionHashes.length !== this.numberOfBlobs()) {
  //     if (!shouldError) {
  //       return;
  //     }
  //     throw new BlockInputError({
  //       code: BlockInputErrorCode.MISSING_VERSIONED_HASHES,
  //       blockRoot: this.prettyRootHex,
  //     });
  //   }
  //   return this.versionHashes;
  // }

  // numberOfBlobs(): number {
  //   if (isBlockInputUnknown(this) || isBlockInputPreData(this)) {
  //     throw new BlockInputError(
  //       {code: BlockInputErrorCode.INVALID_BLOCK_INPUT_TYPE},
  //       "Cannot get numberOfBlobs for Unknown or PreData BlockInputType"
  //     );
  //   }
  //   if (!this.blockWithSource) {
  //     throw new BlockInputError({
  //       code: BlockInputErrorCode.UNKNOWN_NUMBER_OF_BLOBS,
  //       ...this.getLogMeta(),
  //     });
  //   }
  //   return this.blockWithSource.block.message.body.blobKzgCommitments.length;
  // }

  // /**
  //  *
  //  * Blob specific methods
  //  *
  //  */
  // addBlob({rootHex, blobSidecar, source, seenTimestampSec, peerIdStr}: AddBlobProps): void {
  //   this.checkForUndefinedProps({rootHex, blobSidecar, source, seenTimestampSec});
  //   if (rootHex !== this.rootHex) {
  //     throw new BlockInputError(
  //       {
  //         code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
  //         blockInputRoot: this.rootHex,
  //         mismatchedRoot: rootHex,
  //         source: source,
  //         peerId: `${peerIdStr}`,
  //       },
  //       "Blob BeaconBlockHeader rootHex does not match BlockInput.rootHex"
  //     );
  //   }

  //   if (this.blockWithSource) {
  //     const err = this.checkBlockAndBlobArePaired(this.blockWithSource.block, blobSidecar);
  //     if (err) throw err;
  //   }

  //   // TODO: (@matthewkeil) check for duplicates and add metric here
  //   // if (this.blobsCache.has(blobSidecar.index)) {
  //   //   this.metrics.blockInput.duplicateBlob.inc()
  //   // }

  //   this.blobsCache.set(blobSidecar.index, {blobSidecar, source, seenTimestampSec, peerIdStr});

  //   if (!this.needsData()) {
  //     this.dataStatus = BlockInputDataStatus.CompleteData;
  //     this.dataPromise.resolve(this.getAllBlobs() as DataType);
  //     if (this.hasBlock()) {
  //       this.timeCompleteSec = seenTimestampSec;
  //     }
  //   } else if (this.dataStatus === BlockInputDataStatus.NoData) {
  //     this.dataStatus = BlockInputDataStatus.IncompleteData;
  //   }
  // }

  // hasBlob(blobIndex: BlobIndex): boolean {
  //   return this.dataCache.has(blobIndex);
  // }

  // getBlobsWithSource(): DataWithSource<deneb.BlobSidecar>[] {
  //   if (this.dataAvailability === DataAvailabilityStatus.OutOfRange) {
  //     return [];
  //   }

  //   if (this.needsData()) {
  //     const missingIndices = this.getMissingBlobMeta(false)?.map(({index}) => index);
  //     throw new BlockInputError(
  //       {
  //         code: BlockInputErrorCode.INCOMPLETE_DATA,
  //         ...this.getLogMeta(),
  //       },
  //       `Cannot get all blobs.  Missing blob indices ${missingIndices ? prettyPrintArray(missingIndices) : "[ unknown ]"}`
  //     );
  //   }

  //   return [...this.dataCache.values()];
  // }

  // getBlobs(): deneb.BlobSidecars {
  //   return this.getBlobsWithSource().map(({sidecar}) => sidecar);
  // }

  // getMissingBlobMeta(): BlobMeta[];
  // getMissingBlobMeta(shouldError: false): undefined | BlobMeta[];
  // getMissingBlobMeta(shouldError = true): undefined | BlobMeta[] {
  //   const blobMeta: BlobMeta[] = [];
  //   // The call would have succeeded against this implementation, but implementation
  //   // signatures of overloads on extended classes are not externally visible. Need
  //   // to cast `as false` to build
  //   const versionHashes = this.getVersionHashes(shouldError as false);
  //   if (!versionHashes) return;
  //   for (let index = 0; index < versionHashes.length; index++) {
  //     if (!this.blobsCache.has(index)) {
  //       blobMeta.push({
  //         index,
  //         blockRoot: this.blockRoot,
  //         versionHash: versionHashes[index],
  //       });
  //     }
  //   }
  //   return blobMeta;
  // }

  /**
   *
   * Column specific methods
   *
   */
  // addColumn({rootHex, columnSidecar, source, seenTimestampSec, peerIdStr}: AddColumnProps): void {
  //   this.checkForUndefinedProps({rootHex, columnSidecar, source, seenTimestampSec});
  //   if (rootHex !== this.rootHex) {
  //     throw new BlockInputError(
  //       {
  //         code: BlockInputErrorCode.MISMATCHED_ROOT_HEX,
  //         blockInputRoot: this.rootHex,
  //         mismatchedRoot: rootHex,
  //         source: source,
  //         peerId: `${peerIdStr}`,
  //       },
  //       "Column BeaconBlockHeader rootHex does not match BlockInput.rootHex"
  //     );
  //   }

  //   if (this.blockWithSource) {
  //     if (this.blockWithSource.block.message.body.blobKzgCommitments.length === 0) {
  //       throw new BlockInputError(
  //         {
  //           code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT,
  //           blockRoot: this.rootHex,
  //           slot: this.getSlot(),
  //           sidecarIndex: columnSidecar.index,
  //         },
  //         "Block has no kzg commitments but DataColumnSidecar was received"
  //       );
  //     }

  //     const err = this.checkBlockAndColumnArePaired(this.blockWithSource.block, columnSidecar);
  //     if (err) {
  //       throw err;
  //     }
  //   }

  //   this.dataCache.set(columnSidecar.index, {columnSidecar, source, seenTimestampSec, peerIdStr});

  //   if (this.getMissingColumnMeta().length === 0) {
  //     this.dataStatus = BlockInputDataStatus.CompleteData;
  //     // TODO: (@matthewkeil) should this resolve the sampled or custody columns?
  //     this.dataPromise.resolve(this.getSampledColumns() as DataType);
  //     if (this.hasBlock()) {
  //       this.timeCompleteSec = seenTimestampSec;
  //     }
  //   } else if (this.dataStatus === BlockInputDataStatus.NoData) {
  //     this.dataStatus = BlockInputDataStatus.IncompleteData;
  //   }
  // }

  // hasColumn(columnIndex: number): boolean {
  //   return this.dataCache.has(columnIndex);
  // }

  // getCustodyColumns = this.makeColumnsGetter("custody").bind(this);

  // getSampledColumns = this.makeColumnsGetter("sampled").bind(this);

  // getAllColumnsWithSource(): DataWithSource<fulu.DataColumnSidecar>[] {
  //   return [...this.dataCache.values()];
  // }

  // getAllColumns(): fulu.DataColumnSidecars {
  //   return this.getAllColumnsWithSource().map(({sidecar}) => sidecar);
  // }

  // getMissingColumnMeta(): ColumnMeta[] {
  //   const needed: ColumnMeta[] = [];
  //   for (const index of this.custodyConfig.sampledColumns) {
  //     if (!this.dataCache.has(index)) {
  //       needed.push({index, blockRoot: this.blockRoot});
  //     }
  //   }
  //   return needed;
  // }

  /**
   *
   * Async wait methods
   *
   */
  // async waitForBlock(timeoutMs: number, abortSignal?: AbortSignal): Promise<BlockType> {
  //   const signal = abortSignal ? abortSignal : new AbortController().signal;
  //   return withTimeout(() => this.blockPromise.promise, timeoutMs, signal);
  // }

  // async waitForData(timeoutMs: number, abortSignal?: AbortSignal): Promise<DataType> {
  //   const signal = abortSignal ? abortSignal : new AbortController().signal;
  //   return withTimeout(() => this.dataPromise.promise, timeoutMs, signal);
  // }

  // async waitForBlockAndData(timeoutMs: number, abortSignal?: AbortSignal): Promise<BlockInput> {
  //   const signal = abortSignal ? abortSignal : new AbortController().signal;
  //   await withTimeout(() => Promise.all([this.blockPromise.promise, this.dataPromise.promise]), timeoutMs, signal);
  //   return this;
  // }

  /**
   *
   * Private implementation specific methods
   *
   */
  private createPromise<T>(): PromiseParts<T> {
    let resolve!: (value: T) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<T>((_resolve, _reject) => {
      resolve = _resolve;
      reject = _reject;
    });
    return {
      promise,
      resolve,
      reject,
    };
  }

  private checkForUndefinedProps(props: Record<string, unknown>): void {
    for (const [propName, value] of Object.entries(props)) {
      if (value === undefined) {
        throw new BlockInputError({
          code: BlockInputErrorCode.UNDEFINED_PROP,
          blockRoot: this.rootHex,
          propName,
        });
      }
    }
  }

  private checkBlockAndBlobArePaired(
    block: SignedBeaconBlock<ForkName.deneb>,
    blobSidecar: deneb.BlobSidecar
  ): void | BlockInputError {
    if (block.message.slot !== blobSidecar.signedBlockHeader.message.slot) {
      return new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_SLOT,
          blockRoot: this.prettyRootHex,
          blockInputSlot: this.getSlot(false),
          blockSlot: block.message.slot,
          sidecarSlot: blobSidecar.signedBlockHeader.message.slot,
        },
        "Block and blob have mismatched slots"
      );
    }

    if (!byteArrayEquals(block.message.body.blobKzgCommitments[blobSidecar.index], blobSidecar.kzgCommitment)) {
      // TODO: (@matthewkeil) should this eject the bad blob instead? No way to tell if the blob or the block
      //       has the invalid commitment. Guessing it would be the blob though because we match via block
      //       hashTreeRoot and we do not take a hashTreeRoot of the BlobSidecar
      return new BlockInputError(
        {
          code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT,
          blockRoot: this.rootHex,
          slot: block.message.slot,
          sidecarIndex: blobSidecar.index,
        },
        "BlobSidecar commitment does not match block commitment"
      );
    }
  }

  // private checkBlockAndColumnArePaired(block: BlockType, columnSidecar: fulu.DataColumnSidecar): void | Error {
  //   if (block.message.slot !== columnSidecar.signedBlockHeader.message.slot) {
  //     return new BlockInputError(
  //       {
  //         code: BlockInputErrorCode.MISMATCHED_SLOT,
  //         blockRoot: this.prettyRootHex,
  //         blockInputSlot: this.getSlot(false),
  //         blockSlot: block.message.slot,
  //         sidecarSlot: columnSidecar.signedBlockHeader.message.slot,
  //       },
  //       `Block and column have mismatched slots. blockSlot=${block.message.slot} columnSlot=${columnSidecar.signedBlockHeader.message.slot}`
  //     );
  //   }

  //   const expectedCommitments = block.message.body.blobKzgCommitments;

  //   // check for 0 length of sidecar commitments happens in `verifyDataColumnSidecar` when they are
  //   // received via gossip or reqresp
  //   if (expectedCommitments.length !== columnSidecar.kzgCommitments.length) {
  //     return new BlockInputError(
  //       {
  //         code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT_LENGTH,
  //         blockRoot: this.rootHex,
  //         slot: this.getSlot(false),
  //         columnIndex: columnSidecar.index,
  //         blockCommitments: expectedCommitments.length,
  //         sidecarCommitments: columnSidecar.kzgCommitments.length,
  //       },
  //       "DataColumnSidecar commitment length does not match block commitment length"
  //     );
  //   }

  //   for (let index = 0; index < expectedCommitments.length; index++) {
  //     if (!byteArrayEquals(expectedCommitments[index], columnSidecar.kzgCommitments[index])) {
  //       return new BlockInputError(
  //         {
  //           code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT,
  //           blockRoot: this.rootHex,
  //           slot: this.getSlot(false),
  //           sidecarIndex: columnSidecar.index,
  //           commitmentIndex: index,
  //         },
  //         "DataColumnsSidecar kzgCommitment does not match block kzgCommitment"
  //       );
  //     }
  //   }
  // }

  // private makeColumnsGetter(type: "custody" | "sampled"): (throwError?: boolean) => fulu.DataColumnSidecars {
  //   return (throwError = true) => {
  //     const requested: fulu.DataColumnSidecars = [];
  //     const missing: number[] = [];
  //     for (const index of this.custodyConfig[`${type}Columns`]) {
  //       const cachedColumn = this.columnsCache.get(index);
  //       if (cachedColumn) {
  //         requested.push(cachedColumn.columnSidecar);
  //       } else {
  //         missing.push(index);
  //       }
  //     }
  //     if (missing.length && throwError) {
  //       throw new BlockInputError(
  //         {
  //           code: BlockInputErrorCode.INCOMPLETE_DATA,
  //           ...this.getLogMeta(),
  //         },
  //         `Missing ${type} columns=${prettyPrintArray(missing)}`
  //       );
  //     }
  //     return requested;
  //   };
  // }
}
