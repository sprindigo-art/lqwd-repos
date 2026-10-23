/* eslint-disable */
import React, { useState, useEffect } from 'react';
import Balance from '../../components/NodeBalance/Balance';
import './Dashboard.css';
import ChannelDetailsModal from "../../components/ChannelDetails/ChannelDetails";
import Node from '../Node/Node'
import EmptyNode from '../../components/NodeEmpty/NodeEmpty'
import ChannelSummary from '../../components/DashboardChannel/DashboardChannel'
import TransactionRow from "../../components/Transaction/TransactionRow";
import {
    getBTCRate,
    getHTLCEvent,
    getNodeBalanceHistoryEvent,
    getTotalNodeBalance,
} from "./DashboardActions";
import { getAllTransactions } from '../TransactionsPage/TransactionsPageActions'
import { getNodeList, getSharedNodeList } from "../../managers/nodeManager/nodeActions";
import { useDispatch, useSelector } from 'react-redux';
import { changeCurrency } from "./DashboardActions";
import TransactionEmpty from "../../components/Transaction/TransactionEmpty";
import { showCreateNodeModal } from "../CreateNode/CreateNodeActions";
import { getFirstAndLastDayOfMonth } from '../../utils/utils'
import {getTransaction} from "../../utils/transactionUtil";
import {findNodeByName} from '../../managers/nodeManager/nodeManager'
import CloseChannelModal from "../../components/CloseChannel/CloseChannel";
import { getDates, dateDiffInDays } from '../../utils/utils'
import RefreshButton from "../../components/RefreshButton/RefreshButton";
import { requestSyncChannels } from "../../requests/MyChannels";
import { useSnackbar } from "notistack";
import NotificationDuration from "../../NotificationDuration";


const Dashboard = () => {
    const { enqueueSnackbar, closeSnackbar } = useSnackbar();

    const [channel, setChannel] = useState({
        show: false,
        data: {}
    });
    const handleClose = () => setChannel({
        show: false,
        data: {}
    });

    /* set show close channel modal */
    const [showCloseChannelModal, setShowCloseChannelModal] = useState(false);

    const [node, setNode] = useState({
        show: false,
        data: {},
        selectedNode: {},
        nodeBalance: {}
    });

    const showCloseChannel = () => {
        setShowCloseChannelModal(true);
        setChannel({
            show: false,
            data: channel.data
        })
    };

    const hideCloseChannel = () => {
        setShowCloseChannelModal(false);
    };

    const payload = useSelector(state => state.dashboardReducer);
    const nodeReducer = useSelector(state => state.nodeReducer);

    const selectedNodeName = useSelector(state => state.selectedNodeReducer.nodeName);

    let selectedNode = findNodeByName(nodeReducer.nodeList, selectedNodeName);

    if (selectedNode == null){
        selectedNode = findNodeByName(nodeReducer.sharedNodeList, selectedNodeName);
    }

    console.log(selectedNodeName, selectedNode);

    const handleShow = (channelId) => {
        let result = payload.selectedNodeChannels.find(obj => {
            return obj.channelId === channelId
        })
        setChannel({
            show: true,
            data: {
                channelId,
                ...result
            }
        });
    }

    const showChannelDetails = (channel) => {
        handleShow(channel.channelId);
        setShowCloseChannelModal(false);
    };

    const dispatch = useDispatch();

    const setSelectedCurrency = (currency) => {
        dispatch(changeCurrency(currency))
    };


    let date = getFirstAndLastDayOfMonth()

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

    useEffect(() => {
        dispatch(getHTLCEvent(date.first_date, date.last_date))
        dispatch(getNodeBalanceHistoryEvent(date.first_date, date.last_date))
        dispatch(getTotalNodeBalance())
        dispatch(getSharedNodeList())
        dispatch(getNodeList())
        dispatch(getBTCRate())
        dispatch(getAllTransactions())
        document.title = `LQWD | Dashboard`;
    }, []);

    let numberOfChannels = payload.totalChannels;
    let transactions = getTransaction(payload.htlc)

    const allDates = getDates();
    const timespan = { start: allDates.monthStart, end: allDates.monthEnd };
    let dataSize = dateDiffInDays(timespan.start, timespan.end);
    const transactionsReducer = useSelector(state => state.TransactionsReducer);
    let transactionsOfThisMonth = Array(dataSize).fill(0.0);
    let receivedAmount = 0;
    let spentAmount = 0;

    transactionsReducer.transactions.forEach(transaction => {
        let transactionDate = new Date(transaction.CreationDate * 1000);
        let index = dateDiffInDays(timespan.start, transactionDate);
        if (index >= 0 && dateDiffInDays(transactionDate , timespan.end) >= 0){
            if (transaction.Status == 'paid' || transaction.Status == 'settled') {
                if (transaction.isReceived) {
                    transactionsOfThisMonth[index] += Number.parseInt(transaction.Amount) * payload.currency.rate;
                    receivedAmount += Number.parseInt(transaction.Amount) * payload.currency.rate;
                } else {
                    transactionsOfThisMonth[index] -= Number.parseInt(transaction.Amount) * payload.currency.rate;
                    spentAmount += Number.parseInt(transaction.Amount) * payload.currency.rate;
                }
            }

        }
    });

    const getBalances = (nodeName) => {
        console.log(nodeName);
        if (nodeReducer.nodeInfos != null){
            if (nodeReducer.nodeInfos.get(nodeName) != null) {
                return nodeReducer.nodeInfos.get(selectedNode.lndNodeName).balance;
            }
        }else if (nodeReducer.sharedNodeInfos != null){
            if (nodeReducer.sharedNodeInfos.get(nodeName) != null){
                return nodeReducer.sharedNodeInfos.get(selectedNode.lndNodeName).balance;
            }
        }
        return null;
    };

    return (
        <>
            <div className="container-fluid dashboard-container h-100">
                <div className="row">
                    <div className="dashboard-view-holder-lg dashboard-view-holder-sm pt-3">
                        <Balance selectCurrencyFunc={setSelectedCurrency}
                            sent={spentAmount.toPrecision()} currency={payload.currency}
                            balance={payload.balance} allCurrencies={payload.currencies}
                            balanceHistory={payload.balanceHistory} received={receivedAmount.toPrecision()} />
                        <div className='p-3'>{'My Node'}</div>

                        {nodeReducer.nodeList.length > 0 || nodeReducer.sharedNodeList.length > 0 ?
                            <div className="empty-container">

                                <Node  nodes={nodeReducer.nodeList.concat(nodeReducer.sharedNodeList)}
                                    selectedNode={selectedNode}
                                    nodeBalance={selectedNode? getBalances(selectedNode.lndNodeName) : null}/>

                                <div className='total-number-of-channels d-flex justify-content-between'>
                                    <div className='p-2'>Channels</div>
                                    <div className='p-2 d-flex flex-row gap-2 align-items-center'>
                                        <RefreshButton width={"24px"} height={"24px"} rotate={rotateEffect} handleOnClick={() => refreshChannels(selectedNode.lndNodeName)}/>
                                        Total: {numberOfChannels}
                                    </div>
                                </div>
                                <div className='p-2'>
                                    {payload.selectedNodeChannels.map((item) => (
                                        <ChannelSummary key={item.id} prop={item} showChannelDetails={handleShow} />
                                    ))}
                                </div>


                                <ChannelDetailsModal show={channel.show} data={channel.data}
                                                     handleClose={handleClose}
                                                     handleCloseAction={() => showCloseChannel()} />
                                <CloseChannelModal
                                    show={showCloseChannelModal}
                                    channel={channel.data}
                                    handleClose={() => hideCloseChannel()}
                                    onBack={() => showChannelDetails(channel.data)}
                                    dispatch={dispatch}
                                ></CloseChannelModal>

                            </div>
                            :
                            <div className="card border-light bg-white empty-container">
                                <div className="card-body d-flex justify-content-center">
                                    <EmptyNode btnText={"Create Node"} createNodeClicked={() => dispatch(showCreateNodeModal())}></EmptyNode>
                                </div>
                            </div>
                        }


                    </div>
                    <div className="dashboard-transactions d-none col-lg-3 d-md-flex flex-column pt-2">
                        <div className="p-2">
                            <h2 className="text-align-center">All recent transactions</h2>
                        </div>
                        {transactions.sentTransactions.length > 0 ?
                            <TransactionRow
                                transactions={transactions.sentTransactions}
                                date="May 20, 2022"
                            />
                            : ""}
                        {transactions.receivedTransactions.length > 0 ?
                            <TransactionRow
                                transactions={transactions.receivedTransactions}
                                date="May 20, 2022"
                            />
                            : ""
                        }

                        {(transactions.receivedTransactions.length == 0 && transactions.sentTransactions.length == 0)
                            ? <TransactionEmpty text={"Looks like you don’t have any Transaction yet"} />
                            : ""}

                    </div>
                </div>
            </div>
        </>
    );
};

export default Dashboard;
