package com.lqwd.billing.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;

@Data
@Builder
@AllArgsConstructor
public class LNDResponse {
    private int status;
    private String response;
}
