package com.lqwd.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;

@Data
@AllArgsConstructor
@Builder
public class BTCResponse {
    private int status;
    private String message;
    private String response;
}
