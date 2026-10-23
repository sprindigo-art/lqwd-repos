/* eslint-disable */
import {
  MY_CHANNELS_CHANGE_INDEX,
  MY_CHANNELS_CHANNEL_DATA_CHANGED,
  MY_CHANNELS_CLOSE_CHANNEL,
  MY_CHANNELS_CLOSE_CHANNEL_FAIL,
  MY_CHANNELS_CLOSE_CHANNEL_SUCCESS,
  MY_CHANNELS_CONNECT_TO_PEER,
  MY_CHANNELS_CONNECT_TO_PEER_FAIL,
  MY_CHANNELS_CONNECT_TO_PEER_SUCCESS,
  MY_CHANNELS_CREATE_CHANNEL,
  MY_CHANNELS_CREATE_CHANNEL_FAIL,
  MY_CHANNELS_CREATE_CHANNEL_SUCCESS,
  MY_CHANNELS_GET_CHANNEL_DETAIL,
  MY_CHANNELS_GET_CHANNEL_DETAIL_FAIL,
  MY_CHANNELS_GET_CHANNEL_DETAIL_SUCCESS,
  MY_CHANNELS_GET_CHANNELS,
  MY_CHANNELS_GET_CHANNELS_FAIL,
  MY_CHANNELS_GET_CHANNELS_SUCCESS,
  MY_CHANNELS_GET_CLOSED_CHANNELS,
  MY_CHANNELS_GET_CLOSED_CHANNELS_FAIL,
  MY_CHANNELS_GET_CLOSED_CHANNELS_SUCCESS,
  MY_CHANNELS_GET_NODES,
  MY_CHANNELS_GET_NODES_FAILED,
  MY_CHANNELS_GET_NODES_SUCCESS,
  MY_CHANNELS_RESET_CHANNEL_DATA,
  MY_CHANNELS_SELECT_NODE,
  MY_CHANNELS_SHOW_AUTHORIZE_MODAL,
  MY_CHANNELS_SYNC_CHANNELS,
  MY_CHANNELS_SYNC_CHANNELS_FAIL,
  MY_CHANNELS_SYNC_CHANNELS_SUCCESS
} from "./MyChannelsConstants";
import { GET_NODE_DETAIL_SUCCESS } from "../../managers/nodeManager/nodeConstants";

export const initialState = {
  error: false,
  errorMsg: "",
  loading: true,
  myChannels: {
    data: {},
    pageNumber: 0,
    pageSize: 0,
    total: 0,
    totalPages: 0,
  },
  filterOptions: [
    { key: 'all', value: 'All', id: 1, selected: false },
    { key: 'pending', value: 'Pending', id: 2, selected: false },
    { key: 'active', value: 'Active', id: 3, selected: false },
    { key: 'inactive', value: 'Inactive', id: 4, selected: false }
  ],
  channelTable: {
    pageNumber: 0,
    pageSize: 10,
  },
  channelInfo: new Map(),
  nodeInfo: {},
  myNodes: [],
  selectedNode: {},
  channelData: {
    channelName: "",
    localNode: "",
    amount: 0,
    remotePubkey: "",
    remoteHostname: "",
    remotePort: "",
    satPerVByte: "1",
    minHtlc: "1",
    private: false,
  },
  localNode: {},
  remoteNode: {},
  createChannel: null,
  closedChannel: {},
  selectedChannel: {},
  showAuthorize: false,
  activeIndexCreateChannel: 0,
  success: false,
  successMsg: ''
};


// Use the initialState as a default value
export default function myChannelsReducer(state = initialState, action) {
  switch (action.type) {
    case MY_CHANNELS_GET_CHANNELS:
      return { ...state, myChannels: initialState.myChannels, loading: true };
    case MY_CHANNELS_GET_CHANNELS_FAIL:
      return {
        ...state,
        loading: false,
        error: true,
        errorMsg: action.payload.error,
      };
    case MY_CHANNELS_GET_CHANNELS_SUCCESS: {
      return {
        ...state,
        loading: false,
        error: false,
        errorMsg: null,
        filterOptions: state.filterOptions,
        myChannels: action.payload.response
      };
    }
    case MY_CHANNELS_GET_CHANNEL_DETAIL:
      return { ...state, loading: true };
    case MY_CHANNELS_GET_CHANNEL_DETAIL_FAIL:
      return {
        ...state,
        loading: false,
        error: true,
        errorMsg: action.payload.error,
      };
    case MY_CHANNELS_GET_CHANNEL_DETAIL_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
        channelInfo: state.channelInfo.set(action.payload.chanId, action.payload.response.data)
      };
    case MY_CHANNELS_GET_CLOSED_CHANNELS:
      return { ...state, loading: true };
    case MY_CHANNELS_GET_CLOSED_CHANNELS_FAIL:
      return {
        ...state,
        loading: false,
        error: true,
        errorMsg: action.payload.error,
      };
    case MY_CHANNELS_GET_CLOSED_CHANNELS_SUCCESS: {
      return {
        ...state,
        loading: false,
        error: false,
        errorMsg: null,
        filterOptions: state.filterOptions,
        myChannels: action.payload.response
      };
    }
    case MY_CHANNELS_GET_NODES:
      return {...state, loading: true};
    case MY_CHANNELS_GET_NODES_FAILED:
      return {
        ...state,
        loading: false,
        error: true,
        errorMsg: action.payload.error,
      };
    case MY_CHANNELS_GET_NODES_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
        myNodes: JSON.parse(action.payload.response.object),
      };
    case MY_CHANNELS_SELECT_NODE:
      return {
        ...state,
        selectedNode: action.payload.node
      };

    case MY_CHANNELS_CREATE_CHANNEL:
      return {
        ...state,
        loading: true,
        error: false,
        errorMsg: "",
        showAuthorize: false
      };
    case MY_CHANNELS_CREATE_CHANNEL_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
        createChannel: JSON.parse(action.payload.response),
        showAuthorize: false,
        channelData: initialState.channelData
      };
    case MY_CHANNELS_CREATE_CHANNEL_FAIL:
      return {
        ...state,
        loading: false,
        error: true,
        errorMsg: action.payload.error.error,
        showAuthorize: false,
        channelData: initialState.channelData
      };

    case MY_CHANNELS_CONNECT_TO_PEER:
      return {
        ...state,
        localNode: action.payload.localNode,
        remoteNode: action.payload.remoteNode
      };
    case MY_CHANNELS_CONNECT_TO_PEER_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
      };
    case MY_CHANNELS_CONNECT_TO_PEER_FAIL:
      return {
        ...state,
        loading: false,
        error: true,
        errorMsg: action.payload.error,
      };

    case MY_CHANNELS_CLOSE_CHANNEL:
      return {
        ...state,
        channelData: action.payload.channelData,
        password: action.payload.value
      };
    case MY_CHANNELS_CLOSE_CHANNEL_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
        closedChannel: JSON.parse(action.payload.response),
      };
    case MY_CHANNELS_CLOSE_CHANNEL_FAIL:
      return {
        ...state,
        loading: false,
        error: true,
        errorMsg: action.payload.error,
      };
    case GET_NODE_DETAIL_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
        nodeInfo : action.payload.response.data
      };
    case MY_CHANNELS_CHANNEL_DATA_CHANGED:
      return {...state, channelData: action.payload.data };
    case MY_CHANNELS_RESET_CHANNEL_DATA:
      return {
        ...state,
        myChannels: initialState.myChannels,
        selectedNode: initialState.selectedNode,
        channelData: initialState.channelData,
        activeIndexCreateChannel: 0
      };
    case MY_CHANNELS_SHOW_AUTHORIZE_MODAL:
      return {...state, showAuthorize: action.payload.show};
    case MY_CHANNELS_CHANGE_INDEX:
      return {...state, activeIndexCreateChannel: action.payload.index};
    case MY_CHANNELS_SYNC_CHANNELS:
      return {...state, loading: true, error: false, errorMsg: '', success: false, successMsg: ''}
    case MY_CHANNELS_SYNC_CHANNELS_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
        errorMsg: '',
        success: true,
        successMsg: action.payload.response
      }
    case MY_CHANNELS_SYNC_CHANNELS_FAIL:
      return {
        ...state,
        loading: false,
        error: true,
        success: false,
        successMsg: '',
        errorMsg: action.payload.error
      }
    default:
      return state;
  }
}
