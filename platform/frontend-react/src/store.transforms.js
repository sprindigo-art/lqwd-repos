import { createTransform } from 'redux-persist';
import { createBlacklistFilter } from 'redux-persist-transform-filter';

const NodeMapTransform = createTransform(
  // transform state on its way to being serialized and persisted.
  (inboundState, key) => {
    // convert nodeInfos to an Array.
    return {
      ...inboundState,
      nodeInfos: Array.from(inboundState.nodeInfos),
      sharedNodeInfos: Array.from(inboundState.sharedNodeInfos),
    };
  },

  // transform state being rehydrated
  (outboundState, key) => {
    // convert nodeInfos back to a Map.
    return {
      ...outboundState,
      nodeInfos: new Map(outboundState.nodeInfos),
      sharedNodeInfos: new Map(outboundState.sharedNodeInfos),
    };
  },

  // define which reducers this transform gets called for.
  { whitelist: ['nodeReducer'] }
);

const ChannelsMaoTransform = createTransform(
  // transform state on its way to being serialized and persisted.
  (inboundState, key) => {
    // convert channelInfo to an Array.
    return {
      ...inboundState,
      channelInfo: Array.from(inboundState.channelInfo),
    };
  },

  // transform state being rehydrated
  (outboundState, key) => {
    // convert channelInfo back to a Map.
    return {
      ...outboundState,
      channelInfo: new Map(outboundState.channelInfo),
    };
  },

  // define which reducers this transform gets called for.
  { whitelist: ['myChannelsReducer'] }
);

const saveSubsetBlacklistFilter = createBlacklistFilter('globalReducer', [
  'unimportant_data',
]);

const saveSubsetBlacklistFilter2 = createBlacklistFilter('createNodeReducer', [
  'activeStep',
  'plan',
  'info',
  'paymentMethod',
  'showModal',
]);

const saveSubsetBlacklistFilter3 = createBlacklistFilter(
  'transactionDetailsReducer',
  ['transaction', 'showModal']
);
const saveSubsetBlacklistFilter4 = createBlacklistFilter(
  'subscriptionInvoiceModalReducer',
  ['nodeName', 'showModal', 'response']
);

export default [
  NodeMapTransform,
  ChannelsMaoTransform,
  saveSubsetBlacklistFilter,
  saveSubsetBlacklistFilter2,
  saveSubsetBlacklistFilter3,
  saveSubsetBlacklistFilter4,
];
