package com.lqwd.billing.models;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

@Data
@AllArgsConstructor
public class PageResponse<T> {

    private int pageNumber;
    private int pageSize;
    private long total;
    private List<T> data;
    private int totalPages;

}
