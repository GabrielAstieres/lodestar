import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ZERO_HASH} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {describe, expect, it} from "vitest";
import {Batch} from "../../../../../src/sync/range/batch.js";
import {ChainTarget} from "../../../../../src/sync/range/chain.js";
import {ChainPeersBalancer} from "../../../../../src/sync/range/utils/peerBalancer.js";
import {CustodyConfig} from "../../../../../src/util/dataColumns.js";
import {PeerIdStr} from "../../../../../src/util/peerId.js";

describe("sync / range / peerBalancer", () => {
  const custodyConfig = {sampledColumns: [0, 1, 2, 3]} as CustodyConfig;

  describe("bestPeerToRetryBatch", async () => {
    const peer1 = "peer-1";
    const peer2 = "peer-2";
    const peer3 = "peer-3";
    const peers = [peer1, peer2, peer3];

    const testCases: {isFulu: boolean; custodyColumns: number[][]; targetEpochs: number[]; expected: string}[] = [
      {
        isFulu: true,
        // peer3 is free and has full custody columns and has the greater target epoch
        custodyColumns: [[], [0, 1, 2, 3], [0, 1, 2, 3]],
        targetEpochs: [1, 2, 3],
        expected: peer3,
      },
      {
        isFulu: true,
        // peer3 is free and has partial custody columns (0) and has the greater target epoch
        custodyColumns: [[], [0, 1, 2, 3], [0]],
        targetEpochs: [1, 2, 3],
        expected: peer3,
      },
      {
        isFulu: true,
        // peer3 is free and has partial custody columns (3) and has the greater target epoch
        custodyColumns: [[], [0, 1, 2, 3], [3]],
        targetEpochs: [1, 2, 3],
        expected: peer3,
      },
      {
        isFulu: true,
        // peer3 is free and has full custody columns, but don't have greater target epoch
        custodyColumns: [[], [0, 1, 2, 3], [0, 1, 2, 3]],
        targetEpochs: [1, 2, 0],
        expected: peer2,
      },
      {
        isFulu: true,
        // peer3 is free but don't have any custody columns, have greater target epoch
        custodyColumns: [[], [0, 1, 2, 3], [4, 5, 6, 7]],
        targetEpochs: [1, 2, 3],
        expected: peer2,
      },
      {
        isFulu: false,
        // pre-fulu, same to the the above, pick peer3 because it's free
        custodyColumns: [[], [0, 1, 2, 3], [4, 5, 6, 7]],
        targetEpochs: [1, 2, 3],
        expected: peer3,
      },
    ];
    for (const [i, {isFulu, custodyColumns, targetEpochs, expected}] of testCases.entries()) {
      it(`test case ${i}`, async () => {
        const columnsByPeer = new Map<PeerIdStr, {custodyColumns: number[]}>();
        for (const [i, custody] of custodyColumns.entries()) {
          columnsByPeer.set(peers[i], {custodyColumns: custody});
        }

        const targetByPeer = new Map<PeerIdStr, ChainTarget>();
        for (const [i, targetEpoch] of targetEpochs.entries()) {
          targetByPeer.set(peers[i], {slot: computeStartSlotAtEpoch(targetEpoch), root: ZERO_HASH});
        }

        const config = isFulu
          ? createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0})
          : createChainForkConfig(chainConfig);

        const batch0 = new Batch(1, config);
        const batch1 = new Batch(2, config);

        // Batch zero has a failedDownloadAttempt with peer0
        batch0.startDownloading(peer1);
        batch0.downloadingError();

        // peer2 is busy downloading batch1
        batch1.startDownloading(peer2);

        const peerBalancer = new ChainPeersBalancer(targetByPeer, columnsByPeer, [batch0, batch1], custodyConfig);
        expect(peerBalancer.bestPeerToRetryBatch(batch0)).toBe(expected);
      });
    }
  });

  describe("idlePeerForBatch", async () => {
    const peer1 = "peer-1";
    const peer2 = "peer-2";
    const peer3 = "peer-3";
    const peer4 = "peer-4";
    const peers = [peer1, peer2, peer3, peer4];

    const testCases: {
      isFulu: boolean;
      custodyColumns: number[][];
      targetEpochs: number[];
      expected: string | undefined;
    }[] = [
      {
        isFulu: true,
        // peer3 and peer4 are free and have greater target epoch, pick peer3 because it has more custody columns
        custodyColumns: [[], [], [0, 1, 2, 3], [0]],
        targetEpochs: [1, 2, 4, 4],
        expected: peer3,
      },
      {
        isFulu: true,
        // peer3 and peer4 are free, peer3 does not have greater epoch, peer4 has full custody columns, pick peer4
        custodyColumns: [[], [], [0, 1, 2, 3], [0, 1, 2, 3]],
        targetEpochs: [1, 2, 2, 4],
        expected: peer4,
      },
      {
        isFulu: true,
        // peer3 and peer4 are free, peer3 does not have greater epoch, peer4 has partial custody columns, pick peer4
        custodyColumns: [[], [], [0, 1, 2, 3], [3]],
        targetEpochs: [1, 2, 2, 4],
        expected: peer4,
      },
      {
        isFulu: true,
        // peer3 and peer4 are free, peer3 does not have greater epoch, peer4 does not have custody columns we need, pick nothing
        custodyColumns: [[], [], [0, 1, 2, 3], []],
        targetEpochs: [1, 2, 2, 4],
        expected: undefined,
      },
      {
        isFulu: false,
        // pre-fulu, same to the above, pick peer4 because we don't care about custody columns
        custodyColumns: [[], [], [0, 1, 2, 3], []],
        targetEpochs: [1, 2, 2, 4],
        expected: peer4,
      },
    ];

    for (const [i, {isFulu, custodyColumns, targetEpochs, expected}] of testCases.entries()) {
      it(`test case ${i}`, async () => {
        const columnsByPeer = new Map<PeerIdStr, {custodyColumns: number[]}>();
        for (const [i, custody] of custodyColumns.entries()) {
          columnsByPeer.set(peers[i], {custodyColumns: custody});
        }

        const targetByPeer = new Map<PeerIdStr, ChainTarget>();
        for (const [i, targetEpoch] of targetEpochs.entries()) {
          targetByPeer.set(peers[i], {slot: computeStartSlotAtEpoch(targetEpoch), root: ZERO_HASH});
        }

        const config = isFulu
          ? createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0})
          : createChainForkConfig(chainConfig);

        const batch0 = new Batch(1, config);
        const batch1 = new Batch(2, config);
        // peer1 and peer2 are busy downloading
        batch0.startDownloading(peer1);
        batch1.startDownloading(peer2);

        const newBatch = new Batch(3, config);
        const peerBalancer = new ChainPeersBalancer(targetByPeer, columnsByPeer, [batch0, batch1], custodyConfig);
        const idlePeer = peerBalancer.idlePeerForBatch(newBatch);
        expect(idlePeer).toBe(expected);
      });
    }
  });
});
