import {Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {PeerIdStr} from "../../../util/peerId.js";
import {
  BlockInputLogMeta,
  BlockInputSource,
  BlockInputType,
  LogMetaBlobs,
  //  LogMetaColumns
} from "./types.js";

export enum BlockInputErrorCode {
  // Bad Arguments
  UNDEFINED_PROP = "BLOCK_INPUT_ERROR_UNDEFINED_PROP",
  INVALID_CONSTRUCTION = "BLOCK_INPUT_ERROR_INVALID_CONSTRUCTION",

  // Invalid BlockInput type
  UNKNOWN_BLOCK_INPUT_TYPE = "BLOCK_INPUT_ERROR_UNKNOWN_BLOCK_INPUT_TYPE",
  INVALID_BLOCK_INPUT_TYPE = "BLOCK_INPUT_ERROR_INVALID_BLOCK_INPUT_TYPE",

  // Attempt to get all data but some is missing
  INCOMPLETE_DATA = "BLOCK_INPUT_ERROR_INCOMPLETE_DATA",

  // Missing class property values for getters
  MISSING_FORK_NAME = "BLOCK_INPUT_ERROR_MISSING_FORK_NAME",
  MISSING_SLOT = "BLOCK_INPUT_ERROR_MISSING_SLOT",
  MISSING_PARENT_ROOT_HEX = "BLOCK_INPUT_ERROR_MISSING_PARENT_ROOT_HEX",
  MISSING_BLOCK = "BLOCK_INPUT_ERROR_MISSING_BLOCK",
  MISSING_TIME_COMPLETE = "BLOCK_INPUT_ERROR_MISSING_TIME_COMPLETE",
  MISSING_VERSIONED_HASHES = "BLOCK_INPUT_ERROR_MISSING_VERSIONED_HASHES",

  // Mismatched values
  MISMATCHED_ROOT_HEX = "BLOCK_INPUT_ERROR_MISMATCHED_ROOT_HEX",
  MISMATCHED_SLOT = "BLOCK_INPUT_ERROR_MISMATCHED_SLOT",
  MISMATCHED_KZG_COMMITMENT = "BLOCK_INPUT_ERROR_MISMATCHED_KZG_COMMITMENT",
  // MISMATCHED_KZG_COMMITMENT_LENGTH = "BLOCK_INPUT_ERROR_MISMATCHED_KZG_COMMITMENT_LENGTH",

  UNKNOWN_NUMBER_OF_BLOBS = "BLOCK_INPUT_ERROR_UNKNOWN_NUMBER_OF_BLOBS",
}

export type BlockInputErrorType =
  | {
      code:
        | BlockInputErrorCode.MISSING_FORK_NAME
        | BlockInputErrorCode.MISSING_SLOT
        | BlockInputErrorCode.MISSING_PARENT_ROOT_HEX
        | BlockInputErrorCode.MISSING_BLOCK
        | BlockInputErrorCode.MISSING_TIME_COMPLETE
        | BlockInputErrorCode.MISSING_VERSIONED_HASHES
        | BlockInputErrorCode.INVALID_CONSTRUCTION
        | BlockInputErrorCode.UNKNOWN_BLOCK_INPUT_TYPE;
      blockRoot: string;
    }
  | {
      code: BlockInputErrorCode.INVALID_BLOCK_INPUT_TYPE;
      type: BlockInputType;
      blockRoot: string;
    }
  | {
      code: BlockInputErrorCode.UNDEFINED_PROP;
      blockRoot: string;
      propName: string;
    }
  | {
      code: BlockInputErrorCode.MISMATCHED_ROOT_HEX;
      blockInputRoot: string;
      mismatchedRoot: string;
      source: BlockInputSource;
      peerId: PeerIdStr;
    }
  | {
      code: BlockInputErrorCode.MISMATCHED_SLOT;
      blockRoot: string;
      blockInputSlot: undefined | Slot;
      blockSlot: number;
      sidecarSlot: number;
    }
  | {
      code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT;
      blockRoot: string;
      slot: undefined | Slot;
      sidecarIndex: number;
      commitmentIndex?: number;
    }
  // | {
  //     code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT_LENGTH;
  //     blockRoot: string;
  //     slot: undefined | Slot;
  //     columnIndex: number;
  //     blockCommitments: number;
  //     sidecarCommitments: number;
  //   }
  | (BlockInputLogMeta<BlockInputType> & {
      code: BlockInputErrorCode.UNKNOWN_NUMBER_OF_BLOBS | BlockInputErrorCode.INCOMPLETE_DATA;
    });
// | (LogMetaColumns & {code: BlockInputErrorCode.INCOMPLETE_DATA})

export class BlockInputError extends LodestarError<BlockInputErrorType> {}
