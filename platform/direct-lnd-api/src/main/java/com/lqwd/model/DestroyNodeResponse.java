package com.lqwd.model;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class DestroyNodeResponse {
    private boolean success;
    private String error;
}
