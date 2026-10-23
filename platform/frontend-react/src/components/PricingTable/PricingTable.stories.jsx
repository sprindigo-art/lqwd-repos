/* eslint-disable */
import React from 'react';
import PricingTable from "./PricingTable";

export default {
  title: 'Components/Pricing Table',
  component: PricingTable,
};

export const primary = () => {
  return (
    <div>
      <PricingTable show={true}/>
    </div>
  );
};