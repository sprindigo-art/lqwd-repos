/* eslint-disable */
import React from 'react';
import './SubscriptionHistoryCard.css';
import DangerOutlineButton from "../Buttons/DangerOutlineButton";
import Moment from "moment";
export default function SubscriptionHistoryCard({status, planType, node, currency, expiry, total, handleCancel}){

  return (
    <>

      <div className="subscription-modal">
        <div className="subscription-modal-container">
          <div className={status.toLowerCase() == "active" || status.toLowerCase() == "running" ? "subscription-modal-status-running" : "subscription-modal-status-suspended"}>
            <div className="subscription-modal-status-text">{status}</div>
          </div>

          <div className="subscription-modal-row">
            <div className="subscription-modal-col">
              <div className="subscription-modal-header">
                <div className="subscription-modal-title">
                  {planType} Plan: {node}
                </div>
                <div className="subscription-modal-subtitle">
                  Paid by {currency}
                </div>
              </div>
              <div className="subscription-modal-date">
                Expire Date: {Moment(expiry).format("MMM D, YYYY")}
              </div>
            </div>
            <div className="subscription-modal-col d-none d-md-flex">

              <div className="subscription-modal-balance">
                <div className="subscription-modal-balance-title">
                  Total Balance
                </div>
                <div className="subscription-modal-balance-value">
                  {total.toLocaleString('en-GB')} {currency == "BTC" ? " sats" : " USD"}
                </div>
              </div>
              <div className="subscription-modal-cancel-btn">
                {status.toLowerCase() != "suspended" ?
                  <DangerOutlineButton text={"Cancel Subscription"} onClick={handleCancel}></DangerOutlineButton>
                  :
                  <div className="subscription-modal-suspended-text">
                    Node will be deleted in 7 days
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}