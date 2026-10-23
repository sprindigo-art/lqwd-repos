package com.lqwd.constants;

public class ApplicationConstants {

    public static final String NO_CIPHER = "NONE";

    public static final int BATCH_LND_FILE_UPDATE_COUNT=30;

    //regex for validating base64 strings
    public static final String BASE_64_REGEX="^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$";

    //request filter types
    public static enum FileSearchFilters{
        LND_NODE_NAME("Node Type"),
        FILE_TYPE("File Type");

        public final String label;

        private FileSearchFilters(String label) {
            this.label = label;
        }
    }

}
