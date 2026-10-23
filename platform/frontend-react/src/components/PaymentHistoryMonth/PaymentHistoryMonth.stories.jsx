/* eslint-disable */
import React from 'react';
import PaymentHistoryMonth from "./PaymentHistoryMonth";

export default {
  title: 'LQWD Subscription/ Payment History Month Card',
  component: PaymentHistoryMonth,
};

export const main = () => {

  const handleDetailViewClick = () => {
    console.log("Clicked for Details");
  };

  return (
    <div>
      <PaymentHistoryMonth
        monthName={"January"}
        total={30.09}
        handleViewDetail={() => handleDetailViewClick()}></PaymentHistoryMonth>
    </div>
  )
}