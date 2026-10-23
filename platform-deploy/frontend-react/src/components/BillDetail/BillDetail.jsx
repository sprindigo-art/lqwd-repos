/* eslint-disable */
import React, { useState } from "react";
import './BillDetail.css';
import InfoPanel from "../InfoPanel/InfoPanel";
import PrimaryButton from "../Buttons/PrimaryButton";
import rightArrow from "../../public/icons/general/svg/Arrow Right.svg";
import Moment from "moment";

export default function BillDetail({currentBalance, originalBalance,
                                     appliedCredits, lastPayment,
                                     dueDate, receivedBy, late, paid, handleRenew}){

  const [pastDue, setPastDue] = useState(0);

  const pastDueHandle = () => {
    var a = Moment(dueDate);
    var b = Moment.now();

    return Math.abs(a.diff(b, 'days'));
  };

  const billReadyIn = () => {
      // To calculate the no. of days between two dates
      var a = Moment();
      var b = Moment().endOf('month');

      return Math.abs(a.diff(b, 'days'));
  };

  return (
    <>
      <div className="bill-detail-container">
        <div className="bill-detail-info-panel">
          {late ?
            <InfoPanel text={"Balance Owing"} error={true}></InfoPanel>
            :
            <>
              {currentBalance === 0 ?
                <InfoPanel text={"Bill will be ready in " + billReadyIn() + " days"} info={true}></InfoPanel>
                :
                <InfoPanel text={"Bill Ready to be Paid"} success={true}></InfoPanel>
              }
            </>
          }
        </div>

        <div className="bill-detail-current-balance">
          <div className="bill-detail-current-balance-header">
            {late ? "Balance Owing" : "Current Balance"}
          </div>
          <div className={"bill-detail-current-balance-value" + (late ? " late" : " active")}>
            ${currentBalance}
          </div>
          <div className="bill-detail-current-balance-due">
            Due {Moment(dueDate).format("MMM D, YYYY")}
            {late ?
              <span className="bill-detail-late-due">
                (Past due {pastDueHandle()} days)
              </span>
              :
              <></>
            }
          </div>
        </div>
        <div className="bill-detail-current-balance-breakdown">
          <div className="bill-detail-original-balance">
            <div className="bill-detail-applied-credits-key"> Original Balance</div>
            <div className="bill-detail-original-balance-value"> ${originalBalance.toFixed(2)}</div>
          </div>

          {appliedCredits > 0 ?
            <div className="bill-detail-applied-credits">
              <div className="bill-detail-applied-credits-key"> Applied Credits</div>
              <div className="bill-detail-applied-credits-value">${appliedCredits.toFixed(2)}</div>
            </div>
            :
            <></>
          }
          <div className="bill-detail-renew-button">
            <PrimaryButton className="w-100"
                           text={late ? "Pay Bill" : "Renew Subscription"}
                           onClick={handleRenew} disabled={paid}>
            </PrimaryButton>
          </div>
        </div>

        {
          lastPayment == 0 ?
            <></>
            :
            <div className="bill-detail-previous-payment">
              <div className="bill-detail-previous-payment-header">
                Last Payment
              </div>
              <div className="bill-detail-previous-payment-value">
                ${lastPayment.toFixed(2)}
              </div>
              <div className="bill-detail-previous-payment-date">
                Received by {Moment(receivedBy).format("MMM D, YYYY")}
              </div>
            </div>
        }
        <div className="bill-detail-history-link">
          <a href={"/payment-history"}>View Payment History <img src={rightArrow}/></a>
        </div>
      </div>
    </>
  );
}
