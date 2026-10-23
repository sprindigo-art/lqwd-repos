import React from 'react';
import SubscriptionHistoryCard from "./SubscriptionHistoryCard";

export default {
  title: 'LQwD Subscription/Subscription History Card',
  component: SubscriptionHistoryCard
}

export const running = () => {
  return (
    <SubscriptionHistoryCard status={"Running"} currency={"BTC"} expiry={"01/01/2022"} node={"Node 1"} planType={"VIP"} total={"12345678"}></SubscriptionHistoryCard>
  );
}

export const suspended = () => {
  return (
    <SubscriptionHistoryCard status={"CANCELLED"} currency={"BTC"} expiry={"01/01/2022"} node={"Node 1"} planType={"VIP"} total={"12345678"}></SubscriptionHistoryCard>
  );
}