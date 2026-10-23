package com.lqwd.model.util;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class FileUpdateParam {
    Long fileId;
    Long methodId;
    String decrypted;
}
