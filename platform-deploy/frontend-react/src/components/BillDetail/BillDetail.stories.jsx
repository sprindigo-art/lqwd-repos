import React from 'react';
import BillDetail from "./BillDetail";

export default {
  title: 'LQwD Subscription/Bill Detail',
  component: BillDetail
}

export const active = () => {
  return (
    <BillDetail currentBalance={123.12}
                originalBalance={231.23}
                appliedCredits={1}
                dueDate={"01/01/2022"}
                lastPayment={432.43}
                receivedBy={"02/02/2022"}
                late={false}></BillDetail>
  );
};

export const late = () => {
  return (
    <BillDetail currentBalance={123.12}
                originalBalance={231.23}
                appliedCredits={1}
                dueDate={"01/01/2022"}
                lastPayment={432.43}
                receivedBy={"02/02/2022"}
                late={true}></BillDetail>
  );
};