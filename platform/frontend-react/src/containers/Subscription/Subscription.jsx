/* eslint-disable */
import './Subscription.css';
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  cancelSubscription,
  getSubscriptionCurrentInvoice,
  getSubscriptionPaymentHistory,
  getUserActiveSubscriptions, paySubscriptionRequest
} from "./SubscriptionActions";
import { useSnackbar } from "notistack";
import BillDetail from "../../components/BillDetail/BillDetail";
import SubscriptionHistoryCard from "../../components/SubscriptionHistoryCard/SubscriptionHistoryCard";
import SubscriptionPayByModal from "../../components/SubscriptionPayByModal/SubscriptionPayByModal";
import SubscriptionCancelModal from "../../components/SubscriptionCancelModal/SubscriptionCancelModal";
import { requestCancelSubscription, requestPaySubscription } from "../../requests/Subscription";
import NotificationDuration from "../../NotificationDuration";
import Moment from "moment";


const Subscription = () => {

  const dispatch = useDispatch();
  const subscriptionState = useSelector(state => state.subscriptionReducer);
  const nodeState = useSelector(state => state.nodeReducer);
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceModalStep, setInvoiceModalStep] = useState(0);

  const [selectedPrice, setSelectedPrice] = useState(0);
  const [paymentAddress, setPaymentAddress] = useState('');

  const [subscriptionId, setSubscriptionId] = useState(null);
  const [nodeId, setNodeId] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showCancelConfirmDone, setShowCancelConfirmDone] = useState(false);

  const [invoice, setInvoice] = useState(subscriptionState.currentInvoice.invoiceData);

  const handleBackPricingTable = () => {
    setShowInvoiceModal(false);
  }

  const handleSubscriptionButton = () => {
    setShowInvoiceModal(true);
  };

  const generatePaySubscription = (type, invoiceId) => {

    console.log(type, invoiceId);
    // const action = {
    //   payload:
    //     {
    //       "invoiceId": invoiceId,
    //       "method": (type !== "ln" ? "BTC_ADDRESS" : "LND_INVOICE")
    //     }
    // };
    dispatch(paySubscriptionRequest(invoiceId, (type !== "ln" ? "BTC_ADDRESS" : "LND_INVOICE")));
    // requestPaySubscription(action)
    //   .then(function (response) {
    //     console.log(response);
    //     return response.data;
    //   }).catch(function (error) {
    //     console.log(error);
    //   enqueueSnackbar('Error occurred when creating invoice', { variant: 'error', autoHideDuration: NotificationDuration });
    // });
  };

  const handleCancelSubscription = (node, subscriptionId) => {
    console.log("Cancel Subscription - "+ subscriptionId);
    setSubscriptionId(subscriptionId);
    setNodeId(node);
    setShowCancelConfirm(true);
  };

  const confirmCancelSubscription = (subscriptionId) => {
    requestCancelSubscription({ payload: {subscriptionId: subscriptionId }})
      .then(function (response) {

        if (!response.success) {
          enqueueSnackbar(response.error, { variant: 'error', autoHideDuration: NotificationDuration });
          setShowCancelConfirm(false);
        } else {
          enqueueSnackbar('Successfully Canceled Subscription', { variant: 'success', autoHideDuration: NotificationDuration });
          setShowCancelConfirmDone(true);
          setShowCancelConfirm(false);
        }
      }).catch(function (error) {
        enqueueSnackbar('Error occurred when canceling subscription', { variant: 'error', autoHideDuration: NotificationDuration });
        setShowCancelConfirm(false);
    });
  };

  const getNodeBalance = (nodeId) => {

    if (nodeState != null && nodeState.nodeInfos != null){
      if (nodeState.nodeInfos.get(nodeId) != null) {
        return (nodeState.nodeInfos.get(nodeId).balance == null) ? 0 : nodeState.nodeInfos.get(nodeId).balance.total_balance;
      }
    }
    return 0;
  };

  const invoices = [
    {nodeName: "Node1", plan: "VIP Plan", date: "01/01/2022", paidBy: "Paid by LTN", amount: 123.12},
    {nodeName: "Node1", plan: "VIP Plan", date: "01/01/2022", paidBy: "Paid by LTN", amount: 123.12},
    {nodeName: "Node1", plan: "VIP Plan", date: "01/01/2022", paidBy: "Paid by LTN", amount: 123.12},
  ];


  useEffect(() => {
    dispatch(getUserActiveSubscriptions());
    dispatch(getSubscriptionCurrentInvoice());

  }, []);

  console.log(subscriptionState);
  return (
      <>
        <div className="subscription-container">

          <div className="subscription-row">
            <div className="subscription-header">Current Subscriptions</div>
          </div>
          <div className="subscription-row d-flex">
            <div className="subscription-col d-none d-lg-flex">
              <div className="subscription-col-title">
                Bill Detail
              </div>
              {
                subscriptionState.currentInvoice.data.length < 0 ?
                  <BillDetail currentBalance={subscriptionState.currentInvoice.data[0].amount}
                              originalBalance={subscriptionState.currentInvoice.data[0].amount}
                              appliedCredits={0}
                              dueDate={Moment(subscriptionState.currentInvoice.data[0].dateCreated).endOf('month')}
                              lastPayment={0}
                              receivedBy={null}
                              late={Moment(subscriptionState.currentInvoice.data[0].dateCreated).isAfter(Moment.now())}
                              paid={subscriptionState.currentInvoice.data[0].status !== "PENDING"}
                              handleRenew={() => handleSubscriptionButton()}/>
                  :
                  <BillDetail currentBalance={0}
                              originalBalance={0}
                              appliedCredits={0}
                              dueDate={null}
                              lastPayment={0}
                              receivedBy={null}
                              late={false}
                              paid={true}
                              handleRenew={() => handleSubscriptionButton()}/>

              }
            </div>
            <div className="subscription-col w-100">
              <div className="subscription-col-title">
                Subscriptions: {subscriptionState.activeSubscriptions.length}
              </div>
              <div className="subscription-table">
                {
                  subscriptionState.activeSubscriptions.length > 0 ?
                    subscriptionState.activeSubscriptions.map((item) => (
                      <SubscriptionHistoryCard status={item.status}
                                               currency={item.subscriptionPlan.currency.currencyCode}
                                               expiry={item.expiry}
                                               node={item.nodeId}
                                               planType={item.product.productName}
                                               total={getNodeBalance(item.nodeId)}
                                               handleCancel={() => handleCancelSubscription(item.nodeId, item.id)}>
                      </SubscriptionHistoryCard>
                    ))
                    :
                    <></>
                }
              </div>
            </div>
          </div>
        </div>

        {
          subscriptionState.currentInvoice.data.length > 0 ?
            <SubscriptionPayByModal show={showInvoiceModal}
                                    handleBack={() => setInvoiceModalStep(0)}
                                    handleClose={() => setShowInvoiceModal(false)}
                                    step={invoiceModalStep}
                                    handlePayAction={generatePaySubscription}
                                    currentInvoice={subscriptionState.currentInvoice.data[0]}
                                    invoice={subscriptionState.invoiceData}>
            </SubscriptionPayByModal>

            :
            <></>
        }
        {
          subscriptionState.activeSubscriptions.length > 0 ?
            <SubscriptionCancelModal
              node={nodeId}
              show={showCancelConfirm}
              showConfirm={showCancelConfirmDone}
              goBack={() => setShowCancelConfirm(false)}
              handleHide={() => setShowCancelConfirm(false)}
              onDone={() => setShowCancelConfirmDone(false)}
              balance={getNodeBalance(nodeId)}
              handleConfirm={() => confirmCancelSubscription(subscriptionId)} />
            :
            <></>
        }

      </>
  );

}

export default Subscription;