/* eslint-disable */
import { Modal } from "react-bootstrap";
import PrimaryButton from "../Buttons/PrimaryButton";
import React, { useState } from "react";
import './PricingTable.css';
import PricingTierCard from "./PricingTierCards";

export default function PricingTable({show, handleHide, onClose, tierInfo, onSelect, onBack}){

  const tierInfoTemp = [
      {
      title: "Lite",
      amount: 10,
      tierDetails: [
        "Lite 1",
        "Lite 2",
        "Lite 3",
        "Lite 4"
      ],
      currentTier: true,
    },
    {
      title: "Pro",
      amount: 100,
      tierDetails: [
        "Pro 1",
        "Pro 2",
        "Pro 3",
        "Pro 4"
      ],
      currentTier: false,
    },
    {
      title: "VIP",
      amount: 1000,
      tierDetails: [
        "VIP 1",
        "VIP 2",
        "VIP 3",
        "VIP 4"
      ],
      currentTier: false,
    },
  ];

  const [step, setStep] = useState(0);

  const [selectedTier, setSelectedTier] = useState({});

  const handleTierSelected = (tier) => {
    setStep(1);
    setSelectedTier(tier);
  }

  //redirect to pay
  return (
    <>
      <Modal centered size={"lg"} className="" show={show} onHide={handleHide} backdrop='static' keyboard="False">
        <Modal.Header closeButton className="border-0 mx-2">
          {step === 1 ?
            <div style={{ cursor: 'pointer' }} onClick={() => setStep(0)}>
              <svg width="32" height="32" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9.92902 11.9997L13.75 8.17866C14.164 7.76466 14.164 7.09266 13.75 6.67866C13.336 6.26466 12.664 6.26466 12.25 6.67866L7.63602 11.2927C7.24502 11.6837 7.24502 12.3167 7.63602 12.7067L12.25 17.3207C12.664 17.7347 13.336 17.7347 13.75 17.3207C14.164 16.9067 14.164 16.2347 13.75 15.8207L9.92902 11.9997Z" fill="#4D4D4D"/>
              </svg>
            </div>
            :
            <></>
          }

          <h1 className="mb-0">Subscription Tiers</h1>
        </Modal.Header>
        <Modal.Body className="mx-2">
          {step == 0 ?
            <div className="row justify-content-between">
              {tierInfo.map((tier) =>
                <div className="col">
                  <PricingTierCard title={tier.product.productName}
                                   monthlyAmountSats={tier.plans[0].price}
                                   tierInfoList={Array(tier.product.description)}
                                   currentTier={false}
                                   onTierSelect={() => handleTierSelected(tier)}
                  ></PricingTierCard>
                </div>
              )}
            </div>
            :
            <div className="row justify-content-between">
              <div className="col-auto">
                Pay via Lightning Network
                <PrimaryButton text={"Create Invoice"} onClick={() => onSelect("ln", selectedTier)}></PrimaryButton>
              </div>
              <div className="col-auto">
                Pay On-Chain via BTC
                <PrimaryButton text={"Show BTC Address"} onClick={() => onSelect("btc", selectedTier)}></PrimaryButton>
              </div>
            </div>
          }
        </Modal.Body>
      </Modal>
    </>
  );
}