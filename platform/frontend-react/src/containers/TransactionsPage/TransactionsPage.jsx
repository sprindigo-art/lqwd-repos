/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './TransactionsPage.sass';
import { useSnackbar } from 'notistack';
import SearchField from "../../components/SearchField/SearchField";
import PageButtons from "../../components/PageButtons/PageButtons";
import TransactionTable from '../../components/TransactionTable/TransactionTable'
import Select from '../../components/Basic/Select'
import filterIcon from "../../public/icons/general/svg/Filter.svg";
import searchIcon from '../../public/icons/general/svg/Search.svg';
import TransactionFilter from '../../components/TransactionFilter/TransactionFilter'
import TransactionBalance from '../../components/TransactionBalance/TransactionBalance'
import faker from 'faker';
import { useDispatch, useSelector } from 'react-redux';
import { getListOfNodeNames } from '../../managers/nodeManager/nodeManager'
import { transactionsApplyFilter, getAllTransactions } from './TransactionsPageActions'
import { getDates, dateDiffInDays } from '../../utils/utils'
import usdIco from '../../public/icons/dashboard/usd-ref-white.svg'
import { changeCurrency } from "../Dashboard/DashboardActions";
import { showTransactionDetailsAction } from '../TransactionDetails/TransactionDetailsActions'
import { getNodeList, getSharedNodeList } from "../../managers/nodeManager/nodeActions";

var _ = require('lodash');



export default function TransactionsPage() {
    const { enqueueSnackbar, closeSnackbar } = useSnackbar();
    const [showFilter, setShowFilter] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);

    let pageSize = 5;

    const allDates = getDates();

    const [timespan, setTimespan] = useState({ start: allDates.monthStart, end: allDates.monthEnd, type: 'month' });

    const dispatch = useDispatch();
    /* for pagination */
    const nodeReducer = useSelector(state => state.nodeReducer);
    const transactionsReducer = useSelector(state => state.TransactionsReducer);
    const selectedCurrency = useSelector(state => state.dashboardReducer.currency);
    const currencies = useSelector(state => state.dashboardReducer.currencies);

    if (!_.isEmpty(transactionsReducer.response)) {
        console.log(JSON.stringify(transactionsReducer.response));
    }

    let nodelist = getListOfNodeNames(nodeReducer.nodeList.concat(nodeReducer.sharedNodeList));

    let nodefilteroptions = nodelist.map((node, index) => ({ label: node, id: index + 1 }));

    let dataSize = dateDiffInDays(timespan.start, timespan.end);
    let spentArray = Array(dataSize).fill(0);
    let receivedArray = Array(dataSize).fill(0);
    transactionsReducer.transactions.forEach(transaction => {
        let transactionDate = new Date(transaction.CreationDate * 1000);
        let index = dateDiffInDays(timespan.start, transactionDate);
        if (transaction.Status == 'paid' || transaction.Status == 'settled') {
            if (transaction.isReceived) {
                receivedArray[index] += Number.parseInt(transaction.Amount) * selectedCurrency.rate;
            } else {
                spentArray[index] += Number.parseInt(transaction.Amount) * selectedCurrency.rate;
            }
        }
    });

    const onSearch = (e) => {
        let newFilter = JSON.parse(JSON.stringify(transactionsReducer.filter));
        newFilter.byString = e.target.value;
        dispatch(transactionsApplyFilter(newFilter));
        setCurrentPage(1);
    };

    const onTimespanChanged = (timespanType) => {
        let newTimespan = null;
        switch (timespanType) {
            case 'week':
                newTimespan = { start: allDates.weekStart, end: allDates.weekEnd, type: timespanType };
                break;
            case 'month':
                newTimespan = { start: allDates.monthStart, end: allDates.monthEnd, type: timespanType };
                break;
            case 'year':
                newTimespan = { start: allDates.yearStart, end: allDates.yearEnd, type: timespanType };
                break;
            default:
                break;
        }
        if (newTimespan) {
            let newFilter = JSON.parse(JSON.stringify(transactionsReducer.filter));
            newFilter.byDates = {
                from: newTimespan.start,
                to: newTimespan.end,
            };
            dispatch(transactionsApplyFilter(newFilter));
            setTimespan(newTimespan)
        }
    }

    const showTransactionDetails = (TransactionID) => {

        const trx = transactionsReducer.rawTransactionData.find(
            item => item.trxId == TransactionID
        );
        if (trx) {
            dispatch(showTransactionDetailsAction(trx));
        }
    }

    const onFilterClicked = (filter) => {

        if (filter.selectedDates.from && filter.selectedDates.to) {
            setTimespan({ start: filter.selectedDates.from, end: filter.selectedDates.to, type: 'custom' });
        }

        let newFilter = JSON.parse(JSON.stringify(transactionsReducer.filter));
        newFilter.byNodeNames = filter.selectedNodes;
        newFilter.byDates = filter.selectedDates;
        newFilter.bySpentReceived = filter.bySpentReceived;
        newFilter.byTransactionType = filter.byTransactionType;
        newFilter.byStatus = filter.byStatus;
        dispatch(transactionsApplyFilter(newFilter));
        setShowFilter(false);
        setCurrentPage(1);
    }

    useEffect(() => {
        dispatch(getAllTransactions())
        dispatch(getNodeList())
        dispatch(getSharedNodeList())
    }, []);


    const searchDropdownOptions = [
        { value: 'week', label: 'Current week' },
        { value: 'month', label: 'Current month' },
        { value: 'year', label: 'Current year' },
    ]

    return (
        <div className="transaction-page container-fluid h-100 px-0">
            <div className="row h-100">
                <div className={showFilter ? 'd-none d-lg-block col-9' : 'col-12'}>
                    <div className="transaction-container container">
                        <div className="row">
                            <div className="d-flex w-100 flex-row justify-content-between">
                                <div className='d-flex'>
                                    <h1>All Transactions</h1>
                                    <div className="dropend rounded-circle px-2">
                                        <img role="button"
                                            id="dropdownMenuLink" data-bs-toggle="dropdown" aria-expanded="false"
                                            className='currency rounded-circle p-2 ' src={usdIco} />


                                        <ul className="dropdown-menu" aria-labelledby="dropdownMenuLink">
                                            {Object.values(currencies).map((item, num) => (
                                                <li key={item.code}><a className="dropdown-item currency-name" href="#"
                                                    onClick={() => dispatch(changeCurrency(item))}>{item.name} ({item.code})</a>
                                                </li>))}
                                        </ul>
                                    </div>
                                </div>

                                <div className="d-none d-lg-block">
                                    <div className="search-field-input-frame">
                                        <div className="search-icon">
                                            <object data={(searchIcon)} height="20px" width="20px"></object>
                                        </div>
                                        <input className="search-field-input"
                                            id='id' name='NodeName' placeholder={'Search transaction by ID'}
                                            // onFocus={() => showResultsContainer()}
                                            onChange={onSearch}
                                        />
                                    </div>
                                </div>

                            </div>
                        </div>
                        <div className="row">
                            <div className="d-flex flex-row">
                                <div>
                                    <Select
                                        options={searchDropdownOptions}
                                        onChange={onTimespanChanged}
                                        initialValue='month'
                                    ></Select>
                                </div>
                                <div className='d-flex flex-column justify-content-center mx-2'>
                                    <div onClick={() => setShowFilter(true)} style={{ cursor: 'pointer' }}>
                                        <img src={filterIcon} alt="" />
                                        Filter

                                    </div>
                                </div>

                            </div>
                        </div>
                        <div className="row">
                            <TransactionBalance
                                timespan={timespan}
                                currency={selectedCurrency}
                                spent={Number.parseInt(spentArray.reduce((partialSum, a) => partialSum + a, 0))}
                                received={receivedArray.reduce((partialSum, a) => partialSum + a, 0)}
                                transactionReceived={receivedArray}
                                transactionSpent={spentArray}
                                allCurrencies={currencies} />
                        </div>
                        {transactionsReducer.filteredTransactions.length ?
                            <div className="row">
                                <TransactionTable
                                    transactions={transactionsReducer.filteredTransactions}
                                    currency={selectedCurrency}
                                    pageSize={pageSize} currentPage={currentPage}
                                    showTransactionDetails={showTransactionDetails}
                                />
                                <div className="d-none d-lg-block">
                                    <PageButtons
                                        totalPages={Math.floor(transactionsReducer.filteredTransactions.length / pageSize) + 1}
                                        currentPage={currentPage}
                                        handlePageChange={(page, size) => setCurrentPage(page)}></PageButtons>

                                </div>
                            </div>
                            : <></>}

                    </div>
                </div>
                <div className={showFilter ? 'col-12 col-lg-3' : 'd-none'}>
                    <TransactionFilter nodes={nodefilteroptions} onFilterClicked={onFilterClicked} onCloseFilter={() => setShowFilter(false)}></TransactionFilter>

                </div>
            </div>

        </div>
    );
}
