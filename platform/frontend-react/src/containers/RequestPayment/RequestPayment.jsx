/* eslint-disable */
import React, {useEffect} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import TransactionEmpty from "../../components/Transaction/TransactionEmpty";
import PaymentMenuItem from "../SendPayment/PaymentMenuItem";
import invoiceIcon from '../../public/icons/general/svg/invoiceReceive.svg'
import directIcon from '../../public/icons/general/svg/directReceive.svg'
import {getHTLCEvent} from "../Dashboard/DashboardActions";
import {getTransaction} from "../../utils/transactionUtil";
import {getFirstAndLastDayOfMonth} from "../../utils/utils";
import TransactionRow from "../../components/Transaction/TransactionRow";




const RequestPayment = () => {


    const dispatch = useDispatch();

    const dashboardState = useSelector(state => state.dashboardReducer);

    let date = getFirstAndLastDayOfMonth()

    useEffect(() => {
        dispatch(getHTLCEvent(date.first_date, date.last_date))

    }, []);


    let transactions = getTransaction(dashboardState.htlc)

    return (
        <div className="h-100">
            <div className="container-fluid dashboard-container h-100">
                <div className="row h-100">

                    <div className="col-12 col-lg-9 px-5 pt-5">
                        <div className="my-node-title">
                            Request LN Payment
                        </div>

                        <div className="mt-5">
                            <div className="card border-0 shadow-sm rounded-1 mb-4 p-2">
                                <PaymentMenuItem leading={invoiceIcon} text={"Create Invoice"} path={"/create-invoice"} iconBgColor='rgba(254, 232, 199, 1)'/>
                            </div>
                            <div className="card border-0 shadow-sm rounded-1 mb-4 p-2">
                                <PaymentMenuItem leading={directIcon} text={"Direct Payment (keysend)"} path={"/create-invoice-direct"} iconBgColor='rgba(254, 232, 199, 1)'/>
                            </div>
                        </div>
                    </div>

                    <div className="dashboard-transactions d-none col-lg-3 d-md-flex flex-column pt-2">
                        <div className="p-2">
                            <h2 className="text-align-center">Recent LN Payments</h2>
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
                            ? <TransactionEmpty text={"Looks like you don’t have any Transaction yet"}/>
                            : ""}

                    </div>
                </div>
            </div>
        </div>
    );
};

export default RequestPayment;
