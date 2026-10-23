package com.lqwd.model.response;

import lombok.Builder;
import lombok.Data;

@Builder
@Data
public class LndFileItem {

    private Long id;
    private String fileName;
    private String nodeName;
    private String fileType;
    private String cipherMethod;
}
