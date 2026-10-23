/* eslint-disable */
import React, { useState } from "react";
import './PageButtons.css';

export default function PageButtons({id, name, currentPage, totalPages, handlePageChange}) {

  const setClickActive = (active) => {
    console.log(active);
    handlePageChange(active, 10);
  };

  const range2show = (current, total) =>{
    if (total <= 5){
      return {start:1, end:total}
    }

    //near the end
    if ((total - current) < 3 ){
      return {start:total-5, end:total}
    }
    //near the start
    if (current < 3){
      return {start:1, end:5}
    }

    return {start:current-2, end:current+2}
  }

  const getPages = () => {
    let pages = [];
    let ranges =range2show(currentPage , totalPages+1);

    for (let i = 1; i < totalPages+1; i++){
      pages.push(
        <div 
          className={
            (i === currentPage ? "pagination-page-number-active ": "pagination-page-number ")
            + 
            (i >= ranges.start && i <= ranges.end ? '  ' : ' d-none ')
          }  
          onClick={() => setClickActive(i)}>
          <div className="pagination-page-number-text">
            {i}
          </div>
        </div>
      );
    }

    return pages;
  };

  const nextPage = (active) => {
    if (active < totalPages) {
      handlePageChange(active + 1, 10);
    }
  };

  const prevPage = (active) => {
    if (active > 1) {
      handlePageChange(active - 1, 10);
    }
  };

  return (
    <>
      <div className="pagination-container">
        <div className={(currentPage !== 1) ? "pagination-prev" : "pagination-prev-disabled"} onClick={() => prevPage(currentPage)}>
        </div>
        <div className="pagination-pages">
          {getPages()}
        </div>
        <div className={(currentPage !== totalPages) ? "pagination-next" : "pagination-next-disabled"} onClick={() => nextPage(currentPage)}>
        </div>
      </div>
    </>
  );
}