/* eslint-disable */
import React from "react";
import './PaymentHistoryMonth.css';
import arrowRightIcon from '../../public/icons/general/svg/Arrow Right.svg';
import arrowRightIconGrey from '../../public/icons/general/svg/Arrow Right Grey.svg';
import { useSnackbar } from "notistack";
import NotificationDuration from "../../NotificationDuration";

export default function PaymentHistoryMonth({monthName, total, handleViewDetail}) {
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  const deadLink = () => {
    enqueueSnackbar('No Invoice to View!', { variant: 'error', autoHideDuration: NotificationDuration });
  };

  return (
    <>
      <div className={"payment-history-month-container"}>
        <div className={"payment-history-month-header " + (total == 0 ? "shadow-text-color" : "")}>
          {monthName}
        </div>
        <div className={"payment-history-month-subheader " + (total == 0 ? "shadow-text-color" : "")}>
          Total: ${total.toFixed(2)}
        </div>
        <div className={"payment-history-month-view-detail " + (total == 0 ? "shadow-text-color" : "")} style={{cursor: "pointer"}} onClick={(total == 0) ?  () => deadLink() : handleViewDetail}>
          View Detail <img src={(total == 0) ? arrowRightIconGrey : arrowRightIcon} style={{ paddingLeft: "4px" }} />
        </div>
      </div>
    </>
  );
}