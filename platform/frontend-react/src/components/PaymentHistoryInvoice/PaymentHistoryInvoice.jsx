/* eslint-disable */
import React, { useEffect, useRef } from "react";
import './PaymentHistoryInvoice.css';
import backIcon from '../../public/icons/general/svg/Back.svg';
import downloadIcon from '../../public/icons/general/svg/Download.svg';
import Moment from "moment";
import PrimaryButton from "../Buttons/PrimaryButton";
import html2canvas from "html2canvas";

export default function PaymentHistoryInvoice({monthName, total, tax, invoiceDetails, handleBack}) {

  const pdfRef = useRef(null);

  const downloadInvoice = (month) => {

    const input = pdfRef.current;

    html2canvas(input)
      .then((canvas) => {
        const imgData = canvas.toDataURL('image/png');

        // const imgProps= pdf.getImageProperties(imgData);
        // const pdfWidth = pdf.internal.pageSize.getWidth();
        // const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        var a = document.createElement('a');
        a.href = imgData.replace("image/png", "image/octet-stream");
        a.download = month+'-invoice.jpg';
        a.click()
      });

  };

  return (
    <>
      <div ref={pdfRef} className="payment-history-invoice-container">
        <div className="payment-history-invoice-row">
          <div className="payment-history-invoice-header" onClick={handleBack} style={{ cursor: "pointer"}}>
            <img src={backIcon}/>
            {monthName} Invoice
          </div>
        </div>
        <div className="payment-history-invoice-row">
          <div className="payment-history-invoice-download">
            <PrimaryButton text={"Download Invoice"}
                           icon={<img src={downloadIcon}/>}
                           onClick={() => downloadInvoice(monthName)}>
            </PrimaryButton>
          </div>
        </div>
        <div className="payment-history-invoice-download-div">
          <div className="payment-history-invoice-row">
            <div className="payment-history-invoice-table">
              <div className="payment-history-invoice-table-row-header">
                <div className="payment-history-invoice-table-col">Plan</div>
                <div className="payment-history-invoice-table-col">Node</div>
                <div className="payment-history-invoice-table-col">Period</div>
                <div className="payment-history-invoice-table-col">Payment Method</div>
                <div className="payment-history-invoice-table-col">Amount</div>
              </div>
              {
                invoiceDetails.map((item) => (
                  <div className="payment-history-invoice-table-row">
                    <div className="payment-history-invoice-table-col">{item.plan}</div>
                    <div className="payment-history-invoice-table-col">{item.node}</div>
                    <div className="payment-history-invoice-table-col">{Moment(item.dateStart).format("MMM DD")}-{Moment(item.dateEnd).format("DD")}</div>
                    <div className="payment-history-invoice-table-col">Paid By {item.payMethod}</div>
                    <div className="payment-history-invoice-table-col">${item.amount}</div>
                  </div>
                ))
              }
            </div>
          </div>
          <div className="payment-history-invoice-table-total">
              {
                tax != null ?
                  <>
                    <div className="payment-history-invoice-table-total-row">
                      <div className="payment-history-invoice-table-total-col">Subtotal</div>
                      <div className="payment-history-invoice-table-total-col">${(total-tax).toFixed(2)}</div>
                    </div>
                    <div className="payment-history-invoice-table-total-row">
                      <div className="payment-history-invoice-table-total-col">Tax</div>
                      <div className="payment-history-invoice-table-total-col">${tax.toFixed(2)}</div>
                    </div>
                    <div className="payment-history-invoice-table-total-row">
                      <div className="payment-history-invoice-table-total-col" style={{fontWeight: "700px", color: "#000000", lineHeight: "27px", fontSize: "20px"}}>Total</div>
                      <div className="payment-history-invoice-table-total-col" style={{fontWeight: "700px", color: "#000000", lineHeight: "27px", fontSize: "20px", paddingLeft: "20px"}}>${total.toFixed(2)}</div>
                    </div>
                  </>
                  :
                  <div className="payment-history-invoice-table-total-row">
                    <div className="payment-history-invoice-table-total-col" style={{fontWeight: "700px", color: "#000000", lineHeight: "27px", fontSize: "20px"}}>Total</div>
                    <div className="payment-history-invoice-table-total-col" style={{fontWeight: "700px", color: "#000000", lineHeight: "27px", fontSize: "20px", paddingLeft: "20px"}}>${total.toFixed(2)}</div>
                  </div>
              }
          </div>
        </div>
      </div>
    </>
  );
}