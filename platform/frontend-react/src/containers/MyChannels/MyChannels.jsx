/* eslint-disable */
import { useDispatch, useSelector } from "react-redux";
import React, { useEffect, useState } from "react";

import './MyChannels.css';

import {
  getChannels,
  getClosedChannels, getClosedChannelsSuccess,
  getMyChannelsNodes,
  myChannelChangeIndex,
  myChannelResetChannelData,
  selectNode
} from "./MyChannelsActions";

import ChannelTable from "../../components/ChannelTable/ChannelTable";
import FilterDropdown from "../../components/FilterDropdown/FilterDropdown";
import PrimaryButton from "../../components/Buttons/PrimaryButton";

import historyIcon from "../../public/icons/general/png/History.png";
import nodeIcon from "../../public/icons/dashboard/node.svg";
import backIcon from "../../public/icons/general/svg/Back.svg";

import MyChannelsCreateChannel from "./MyChannelsCreateChannel";
import ChannelDetailsModal from "../../components/ChannelDetails/ChannelDetails";
import CloseChannelModal from "../../components/CloseChannel/CloseChannel";
import SearchField from "../../components/SearchField/SearchField";
import PageButtons from "../../components/PageButtons/PageButtons";
import MyChannelsHeader from "./MyChannelsHeader";
import ChannelTableMobile from "../../components/ChannelTable/ChannelTableMobile";
import { requestGetClosedChannels, requestSyncChannels } from "../../requests/MyChannels";
import RefreshButton from "../../components/RefreshButton/RefreshButton";
import NotificationDuration from "../../NotificationDuration";
import { useSnackbar } from "notistack";
import { getNodeList, getSharedNodeList } from "../../managers/nodeManager/nodeActions";

const MyChannels = () => {

  const myChannelsState = useSelector(state => state.myChannelsReducer);
  const nodeState = useSelector(state => state.nodeReducer);
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  const dispatch = useDispatch();

  const tempBalance = {
    confirmed_balance: 0,
    unconfirmed_balance: 0,
    total_balance: 0
  };

  const channelViews = [
    'active-channels-view',
    'closed-channels-view',
    'create-channel',
    'close-channel'
  ];

  /* for pagination */
  const [channelTable, setChannelTable] = useState();

  /* Set State for View to Show */
  const [currentActiveView, setCurrentActiveView] = useState(channelViews[0]);

  /* set show state channel details */
  const [showChannelDetailsModal, setShowChannelDetailsModal] = useState(false);

  /* set show close channel modal */
  const [showCloseChannelModal, setShowCloseChannelModal] = useState(false);

  /* for header nodes */
  const initialValue = [...Array(myChannelsState.myNodes.length)].fill(0);
  initialValue[0] = true;

  const [isActive, setIsActive] = useState(initialValue);

  const [searchResults, setSearchResults] = useState([]);

  const [searchTerm, setSearchTerm] = useState('')

  //selecting node at header
  const onclick = (id) => {
    let arr = [...Array(myChannelsState.myNodes.length)].fill(0);

    arr[id] = true;
    setIsActive(arr);
    console.log(id, myChannelsState.myNodes[id]);

    if (myChannelsState.myNodes[id] === undefined){
      dispatch(selectNode(nodeState.sharedNodeList[id]))
      dispatch(getChannels(nodeState.sharedNodeList[id].lndNodeName, myChannelsState.channelTable, myChannelsState.filterOptions))
    }else{
      dispatch(selectNode(myChannelsState.myNodes[id]))
      dispatch(getChannels(myChannelsState.myNodes[id].lndNodeName, myChannelsState.channelTable, myChannelsState.filterOptions))

    }
  };

  //set selected node from header
  const setSelectNode = (node) => {
    console.log(node);
    dispatch(selectNode(node));
    dispatch(getChannels(node.lndNodeName, myChannelsState.channelTable, myChannelsState.filterOptions));
  };

  //set filter on change
  const handleFilterChange = (selectedNode) => {
    dispatch(getChannels(selectedNode.lndNodeName, myChannelsState.channelTable, myChannelsState.filterOptions));
  };

  //redirect action for no nodes created
  const redirectToMyNodesPage = () => {
    window.location = "/nodes";
  };

  const showChannelDetails = (channel) => {
    myChannelsState.selectedChannel = channel;
    console.log(myChannelsState);
    setShowChannelDetailsModal(true);
    setShowCloseChannelModal(false);
  };

  const hideChannelDetails = () => {
    setShowChannelDetailsModal(false);
    // setCurrentActiveView(channelViews[0]);
  };

  const showCloseChannel = () => {
    setShowCloseChannelModal(true);
    setShowChannelDetailsModal(false);
  };

  const showClosedChannels = () => {
    // dispatch(getClosedChannels(myChannelsState.channelTable));
    requestGetClosedChannels({nodeName: myChannelsState.selectedNode.lndNodeName, pageNumber: 0, pageSize: 10})
      .then(function(response){
        console.log(response);
        if (response.data !== undefined){
          dispatch(getClosedChannelsSuccess(response))
          enqueueSnackbar("Successfully Retrieved Closed Channels!", { variant: 'success', autoHideDuration: NotificationDuration });
          setCurrentActiveView('closed-channels-view')
        }else{
          enqueueSnackbar("Failed to Look Up Closed Channels", { variant: 'error', autoHideDuration: NotificationDuration });
        }
      }).catch(function(error){
        console.log(error);
        enqueueSnackbar("Failed to Look Up Closed Channels", { variant: 'error', autoHideDuration: NotificationDuration });
    });
  };

  const hideCloseChannel = () => {
    setShowCloseChannelModal(false);
    dispatch(getMyChannelsNodes());
  };

  const showCreateChannelView = () => {
    setCurrentActiveView(channelViews[2])
    dispatch(myChannelResetChannelData())
    dispatch(myChannelChangeIndex(0))
  }

  const changePage = (pageNumberVal, pageSizeVal) => {
    console.log(pageNumberVal-1, pageSizeVal);

    myChannelsState.channelTable = {
      pageNumber: pageNumberVal-1,
      pageSize: pageSizeVal
    };

    dispatch(getChannels(myChannelsState.selectedNode.lndNodeName, myChannelsState.channelTable, myChannelsState.filterOptions))
  }

  const [rotateEffect, setRotateEffect] = useState(false);

  const refreshChannels = (nodeName) => {
    // dispatch(syncChannelData(nodeName))
    console.log(nodeName);
    setRotateEffect(true);
    requestSyncChannels({ nodeName: nodeName })
      .then(function(response){
        console.log(response);
        if (response.status === 200){
          enqueueSnackbar(response.message, { variant: 'success', autoHideDuration: NotificationDuration });
        }else{
          enqueueSnackbar(response.message, { variant: 'error', autoHideDuration: NotificationDuration });
        }
        setRotateEffect(false);
      }).catch(function(error){
      console.log(error);
      setRotateEffect(false);
      enqueueSnackbar("Failed to Sync Channels", { variant: 'error', autoHideDuration: NotificationDuration });
    });
  };

  const mainChannelsView = (myChannelsState) => {

    return (
      <div className="container h-100">
        <div className="my-channels-title-container d-flex">
          <div className="p-2">
            <div className="my-channels-title">
              My Channels
            </div>
            <div className="my-channels-total">
              Total numbers: {myChannelsState.myChannels.total}
            </div>
          </div>
          {myChannelsState.myNodes.length > 0?
              <div className="my-channels-button">
                {myChannelsState.myChannels.data.length > 0 ?

                    <SearchField id={"search-field"} name={"search-field"} placeholder={"Search Channels"}
                                 onChange={(e) => setSearchTerm(e)}
                                 handleClick={showChannelDetails}
                                 resultList={searchResults}
                    ></SearchField>

                    :
                    <></>

                }
                <PrimaryButton
                    text="Create Channel"
                    icon={
                      <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="32"
                          height="32"
                          fill="currentColor"
                          className="bi bi-plus"
                          viewBox="0 0 16 16"
                      >
                        <path
                            d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                      </svg>
                    }
                    onClick={() => showCreateChannelView()}
                ></PrimaryButton>
              </div>
              :
              <></>
          }
        </div>

        {(myChannelsState.myNodes.length > 0 || nodeState.sharedNodeList.length > 0) && myChannelsState.selectedNode != null ?
          <div>
            <div className="m-2 d-flex flex-row justify-content-between">
              <div className="col-8">
                <MyChannelsHeader state={myChannelsState} onClickHandle={onclick} isActiveNode={isActive} nodeState={nodeState}></MyChannelsHeader>
              </div>
              <div onClick={() => showClosedChannels()} className="d-none d-md-flex flex-row align-items-center">
                <img className="m-1 closed-channel-link-icon-container" src={historyIcon} />
                <div className="closed-channel-link-text m1">View Closed Channel History</div>
              </div>
            </div>

            <div className="m-2">
              <div className={"d-flex flex-row justify-content-between align-items-center"}>
                <FilterDropdown filterTitle="Filter" filterOptions={myChannelsState.filterOptions}
                                onChange={() => handleFilterChange(myChannelsState.selectedNode)}
                                onReset={() => handleFilterChange(myChannelsState.selectedNode)}>

                </FilterDropdown>

                <RefreshButton width={"24px"} height={"24px"} rotate={rotateEffect} label={"Refresh Channels"} handleOnClick={() => refreshChannels(myChannelsState.selectedNode.lndNodeName)}/>
              </div>
              <div style={{paddingTop: 12+"px"}}></div>
              <ChannelTable channels={myChannelsState.myChannels}
                            selectedNode={myChannelsState.selectedNode}
                            selectNode={setSelectNode}
                            onItemClick={showChannelDetails}>
              </ChannelTable>
              {
                myChannelsState.myChannels.data.length > 0 ?
                  <PageButtons totalPages={myChannelsState.myChannels.totalPages} currentPage={myChannelsState.myChannels.pageNumber+1} handlePageChange={changePage}></PageButtons>
                  :
                  <></>
              }
            </div>
           </div>
          :
          <div className="row p-5">
            <div className="d-inline-flex justify-content-center">
              <div className="d-flex flex-column justify-content-center">
                <div className="p-4 align-self-center">
                  <img role="button" id="dropdownMenuLink" data-bs-toggle="dropdown" aria-expanded="false" src={nodeIcon}/>
                </div>
                <div className="p-2 align-self-center desc">You need to create a node first to have channels with others</div>
                <div className="p-2 align-self-center">
                  <PrimaryButton onClick={redirectToMyNodesPage} text='Go to My Nodes' />
                </div>
              </div>
            </div>
          </div>
        }
      <ChannelDetailsModal handleClose={() => hideChannelDetails()}
                           show={showChannelDetailsModal}
                           data={myChannelsState.selectedChannel}
                           handleCloseAction={myChannelsState.selectedChannel != null ? () => showCloseChannel() : false}
      ></ChannelDetailsModal>
      <CloseChannelModal
          show={showCloseChannelModal}
          channel={myChannelsState.selectedChannel}
          handleClose={() => hideCloseChannel()}
          onBack={() => showChannelDetails(myChannelsState.selectedChannel)}
          dispatch={dispatch}
        ></CloseChannelModal>
      </div>
    );
  }

  const closedChannels = (myChannelsState) => {
    return (
      <div>
        <div className="container h-100">
          <div className="p-2">
            <div className="my-channels-title"
                 onClick={() => {
              dispatch(getMyChannelsNodes());
              setCurrentActiveView('active-channels-view')}
            }>
              <img src={backIcon} className="closed-channels-back"/>
              Closed Channels
            </div>
          </div>
          {myChannelsState.myChannels.data.length > 0 ?
            <div>
              <ChannelTable channels={myChannelsState.myChannels} selectedNode={myChannelsState.selectedNode}
                            onItemClick={showChannelDetails} selectNode={setSelectNode} ></ChannelTable>
            </div>
            :

            <div className="row p-5">
              <div className="channel-table-empty-container">
                <div className="channel-table-empty-text justify-content-center">
                  Looks like you don't have any closed channels yet.
                </div>
              </div>
            </div>
          }
        </div>

        <ChannelDetailsModal handleClose={() => hideChannelDetails()}
                             show={showChannelDetailsModal}
                             data={myChannelsState.selectedChannel}
                             handleCloseAction={() => showCloseChannel()}
        ></ChannelDetailsModal>
        <CloseChannelModal
            show={showCloseChannelModal}
            channel={myChannelsState.selectedChannel}
            handleClose={() => hideCloseChannel()}
            onBack={() => showChannelDetails(myChannelsState.selectedChannel)}
            dispatch={dispatch}
        ></CloseChannelModal>
      </div>
    );

  }

  const createChannel = (myChannelsState) => {
    return <MyChannelsCreateChannel
      state={myChannelsState}
      nodeState={nodeState}
      goBack={() => setCurrentActiveView(channelViews[0])}
      dispatch={dispatch}></MyChannelsCreateChannel>
  }

  const mobileChannelsView = (myChannelsState) => {
    console.log(myChannelsState);
    return (
      <div className="container h-100">
        <div className="my-channels-title-container d-flex flex-row mx-0">
          <div className="p-2 col-auto">
            <div className="my-channels-title">
              My Channels
            </div>
            <div className="my-channels-total">
              Total numbers: {myChannelsState.myChannels.total}
            </div>
          </div>
          <div onClick={() => showClosedChannels()} className="col-auto d-none d-sm-flex">
            <div className="closed-channel-link-text m1">
              <img className="m-1" src={historyIcon} />
              View Closed Channels
            </div>
          </div>
        </div>

        {(myChannelsState.myNodes.length > 0 || nodeState.sharedNodeList.length > 0) && myChannelsState.selectedNode != null ?
          <div>
            <div className="row justify-content-between">
              <div className="col-12">
                <MyChannelsHeader state={myChannelsState} onClickHandle={onclick} isActiveNode={isActive} nodeState={nodeState}></MyChannelsHeader>
              </div>
            </div>

            <div className="m-2">
              <div style={{paddingTop: 12+"px"}}></div>
              <ChannelTableMobile channels={myChannelsState.myChannels}
                            selectedNode={myChannelsState.selectedNode}
                            selectNode={setSelectNode}
                            onItemClick={showChannelDetails}/>


              {/*<PageButtons totalPages={myChannelsState.myChannels.totalPages} currentPage={myChannelsState.myChannels.pageNumber+1} handlePageChange={changePage}></PageButtons>*/}
            </div>
            <ChannelDetailsModal handleClose={() => hideChannelDetails()}
                                 show={showChannelDetailsModal}
                                 data={myChannelsState.selectedChannel}
                                 handleCloseAction={() => showCloseChannel()}
                                 isMobile={true}
            ></ChannelDetailsModal>
          </div>
          :
          <div className="row p-5">
            <div className="d-inline-flex justify-content-center">
              <div className="d-flex flex-column justify-content-center">
                <div className="p-4 align-self-center">
                  <img role="button" id="dropdownMenuLink" data-bs-toggle="dropdown" aria-expanded="false" src={nodeIcon}/>
                </div>
                <div className="p-2 align-self-center desc">You need to create a node first to have a channels with others</div>
                <div className="p-2 align-self-center">
                  <PrimaryButton onClick={redirectToMyNodesPage} text='Go to My Nodes' />
                </div>
              </div>
            </div>
          </div>
        }

      </div>
    );
  }

  const [width, setWidth] = useState(window.innerWidth);

  function handleWindowSizeChange() {
    setWidth(window.innerWidth);
  }

  const isMobile = width <= 768;

  useEffect(() => {
    dispatch(getMyChannelsNodes())
    dispatch(getNodeList())
    dispatch(getSharedNodeList())

    document.title = `LQwD | My Channels`;

    window.addEventListener('resize', handleWindowSizeChange);

    return () => {
      window.removeEventListener('resize', handleWindowSizeChange);
    }
  }, [])

  return (
    <>

          {(() => {
            switch (currentActiveView) {
              case channelViews[0]:
                return isMobile ? mobileChannelsView(myChannelsState) : mainChannelsView(myChannelsState)
              case channelViews[1]:
                return closedChannels(myChannelsState)
              case channelViews[2]:
                return createChannel(myChannelsState)
              default:
                return <div></div>
            }
          })()}


    </>
  );
};

export default MyChannels;