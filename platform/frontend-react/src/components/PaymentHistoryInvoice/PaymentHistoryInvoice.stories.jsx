/* eslint-disable */
import React from 'react';
import PaymentHistoryInvoice from "./PaymentHistoryInvoice";

export default {
  title: 'LQWD Subscription/Payment History Invoice',
  component: PaymentHistoryInvoice,
};

export const main = () => {

  const invoiceDetailsExample = [

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


  ];

  return (
    <div>
      <PaymentHistoryInvoice monthName={"January"}
                             tax={1.74}
                             total={36.72}
                             invoiceDetails={invoiceDetailsExample} ></PaymentHistoryInvoice>
    </div>
  )
}