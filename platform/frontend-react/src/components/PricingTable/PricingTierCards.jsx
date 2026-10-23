/* eslint-disable */

import PrimaryButton from "../Buttons/PrimaryButton";
import React from "react";

export default function PricingTierCard({title, monthlyAmountSats, tierInfoList, onTierSelect, currentTier}){
  return (
    <>
      <div className="card mb-4 box-shadow">
        <div className="card-header">
          <h4 className="my-0 font-weight-normal text-center">{title}</h4>
        </div>
        <div className="card-body">
          <h1 className="card-title pricing-card-title text-center">{monthlyAmountSats} sats<small className="text-muted">/ mo</small></h1>
          <ul className="list-unstyled mt-3 mb-4">
            {
              tierInfoList.map((item) =>
                <li>{item}</li>
              )
            }
          </ul>
          <PrimaryButton className={"w-100"} disabled={currentTier} text={currentTier ? "Selected" : "Select " + title + " Tier"} onClick={onTierSelect}></PrimaryButton>
        </div>
      </div>
    </>
  );
}