/* eslint-disable */
/* global jsPDF */
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import './PaymentHistory.css';
import backIcon from '../../public/icons/general/svg/Back.svg';
import PaymentHistoryMonth from "../../components/PaymentHistoryMonth/PaymentHistoryMonth";
import Select from "../../components/Basic/Select";
import { useNavigate } from "react-router-dom";
import { getSubscriptionPaymentHistory } from "../Subscription/SubscriptionActions";
import { value } from "lodash/seq";
import PaymentHistoryInvoice from "../../components/PaymentHistoryInvoice/PaymentHistoryInvoice";
import Moment from "moment";
import moment from "moment";

const PaymentHistory = () => {
  const dispatch = useDispatch();
  const subscriptionState = useSelector(state => state.subscriptionReducer);
  const navigate = useNavigate();

  const [month, setMonth] = useState("");
  const [total, setTotal] = useState(0);

  const [year, setYear] = useState(Moment().year());

  const [startDate, setStartDate] = useState(Moment(year, 'YYYY').startOf('year').format("DD-MM-YYYY"));
  const [endDate, setEndDate] = useState(Moment(year, 'YYYY').endOf('year').format("DD-MM-YYYY"));

  const [showPaymentInvoiceDetail, setShowPaymentInvoiceDetail] = useState(false);

  const [invoiceDetails, setInvoiceDetails] = useState([

    {
      plan: "Lite Plan",
      node: "Node 1",
      dateStart: "01/01/2022",
      dateEnd: "01/31/2022",
      payMethod: "BTC",
      amount: 9.99
    },
    {
      plan: "VIP Plan",
      node: "Node 2",
      dateStart: "01/12/2022",
      dateEnd: "01/31/2022",
      payMethod: "LTN",
      amount: 15.99
    },
    {
      plan: "Pro Plan",
      node: "Node 3",
      dateStart: "01/01/2022",
      dateEnd: "01/13/2022",
      payMethod: "LTN",
      amount: 8.99
    },
    {
      plan: "Lite Plan",
      node: "Node 4",
      dateStart: "01/01/2022",
      dateEnd: "01/13/2022",
      payMethod: "BTC",
      amount: 3.99
    },


  ]);

  const billMonthExample = [
    {
      month: "January",
      total: 123.54,
    },
    {
      month: "February",
      total: 123.54,
    },
    {
      month: "March",
      total: 123.54,
    },
    {
      month: "April",
      total: 123.54,
    },
    {
      month: "May",
      total: 123.54,
    },
    {
      month: "June",
      total: 123.54,
    },
    {
      month: "July",
      total: 123.54,
    },
    {
      month: "August",
      total: 123.54,
    },
    {
      month: "September",
      total: 123.54,
    },
    {
      month: "October",
      total: 123.54,
    },
    {
      month: "November",
      total: 0.0,
    },
    {
      month: "December",
      total: 0.0,
    }
  ];

  const years = [
    {
      value: 2022,
      label: "2022"
    },
    {
      value: 2023,
      label: "2023"
    },
  ];

  const handleOnSelectYearChange = (yearSelected) => {
    dispatch(getSubscriptionPaymentHistory(
      Moment(yearSelected, 'YYYY').startOf('year').format("DD-MM-YYYY"),
      Moment(yearSelected, 'YYYY').endOf('year').format("DD-MM-YYYY")));
  };

  const handleViewDetailClick = (month, total) => {
    setMonth(Moment(month, 'MM-YYYY').format('MMMM'));
    setTotal(total);
    setShowPaymentInvoiceDetail(true);
  };

  const handleGoBack = () => {
    navigate("/subscribe");
  };

  console.log(subscriptionState);
  useEffect(() => {
    dispatch(getSubscriptionPaymentHistory(startDate, endDate));
  },[]);

  return (
    <>
      <div className={showPaymentInvoiceDetail ? "d-none": "payment-history-container"}>
        <div className="payment-history-header" style={{cursor: "pointer"}} onClick={() => handleGoBack()}>
          <img src={backIcon}/>
          Payment History
        </div>
        <div className="payment-history-col">
          <div className="payment-history-year-dropdown">
            <Select options={years} onChange={handleOnSelectYearChange}></Select>
          </div>
          <div className="row payment-history-month">
            {
              subscriptionState.paymentHistory.length > 0 ?
                subscriptionState.paymentHistory.map((item) => (
                    <div className="col-auto">
                      <PaymentHistoryMonth
                        monthName={Moment(item.date, 'MM-YYYY').format('MMMM')}
                        total={item.totalAmount}
                        handleViewDetail={() => handleViewDetailClick(item.date, item.totalAmount)}>
                      </PaymentHistoryMonth>
                    </div>
                  ))
                :
                <></>
            }
          </div>
        </div>
      </div>
      <div className={showPaymentInvoiceDetail ? "payment-history-container" :"d-none"}>
        <PaymentHistoryInvoice invoiceDetails={invoiceDetails} total={total} monthName={month} handleBack={() => setShowPaymentInvoiceDetail(false)}></PaymentHistoryInvoice>
      </div>
      <script src={"https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"}></script>
    </>
  );
};

export default PaymentHistory;