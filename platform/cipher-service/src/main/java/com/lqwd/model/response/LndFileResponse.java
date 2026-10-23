package com.lqwd.model.response;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Builder
@Data
public class LndFileResponse {

    private List<LndFileItem> files;
    private List<Integer> pageNumbers;
    private int currentPageNumber;

}
