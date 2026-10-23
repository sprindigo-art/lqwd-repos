/* eslint-disable */
import React, { useState } from "react";
import SubscriptionPayByModal from "./SubscriptionPayByModal";

export default {
  title: "LQwD Subscription/Subscription Pay By Modal",
  component: SubscriptionPayByModal
}

export const payBy = () => {
  const [step, setStep] = useState(0);

  const handleLN = () => {
    setStep(1);
  };

  const handleBTC = () => {
    setStep(1);
  };

  const invoices = {
    invoices:
    [
      {nodeName: "Node1", plan: "VIP Plan", date: "01/01/2022", paidBy: "Paid by LTN", amount: 123.12},
      {nodeName: "Node1", plan: "VIP Plan", date: "01/01/2022", paidBy: "Paid by LTN", amount: 123.12},
      {nodeName: "Node1", plan: "VIP Plan", date: "01/01/2022", paidBy: "Paid by LTN", amount: 123.12},
    ],
    amount: (123.12*4),
    subtotal: (123.12*4),
    tax: (123.12*4)*0.12,
};

  return (
    <SubscriptionPayByModal handleBack={() => setStep(0)}
                            handleClose={() => setStep(0)}
                            handlePayByLN={() => handleLN()}
                            handlePayByBTC={() => handleBTC()}
                            amount={100}
                            currentInvoice={invoices}
                            invoiceInfo={invoices}
                            invoice={"d0d2b817f643eb8a978574c932150571746c59924a72db337d38d904cb79de95c754de09e58db655c7a276263a1b1646a726c4a0bb4bce5a74474ece962f3eced0d2b817f643eb8a978574c93215057"}
                            subtotal={100} tax={12}>
    </SubscriptionPayByModal>
  );
}